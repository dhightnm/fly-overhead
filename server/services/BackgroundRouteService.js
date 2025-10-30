const postgresRepository = require('../repositories/PostgresRepository');
const flightRouteService = require('./FlightRouteService');
const logger = require('../utils/logger');

/**
 * Background service to periodically populate route database
 * Runs at a slow rate to avoid API rate limits and costs
 * Goal: Build up historical route data over time for inference
 */
class BackgroundRouteService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    // Process 5 flights every 5 minutes = 60 flights/hour = ~1440 flights/day
    this.BATCH_SIZE = 5;
    this.INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    this.BACKFILL_BATCH = 10; // sample backfill size
    this.FLIGHTAWARE_CALLS_CAP = parseInt(process.env.FA_BACKFILL_CAP || '50', 10);
  }

  /**
   * Start the background job
   */
  start() {
    if (this.isRunning) {
      logger.warn('Background route service is already running');
      return;
    }

    logger.info('Starting background route population service', {
      batchSize: this.BATCH_SIZE,
      intervalMinutes: this.INTERVAL_MS / (60 * 1000),
    });

    this.isRunning = true;

    // Run immediately on start
    this.processRoutes();

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.processRoutes();
    }, this.INTERVAL_MS);
  }

  /**
   * Stop the background job
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Background route population service stopped');
  }

  /**
   * Process a batch of aircraft routes
   */
  async processRoutes() {
    try {
      logger.info('Background route job starting', { batchSize: this.BATCH_SIZE });

      // Get recent aircraft that don't have route data cached
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
      const aircraft = await postgresRepository.findRecentAircraftWithoutRoutes(
        tenMinutesAgo,
        this.BATCH_SIZE,
      );

      if (aircraft.length === 0) {
        logger.info('No aircraft need route data at this time');
        return;
      }

      logger.info(`Processing ${aircraft.length} aircraft for background route population`);

      // Process each aircraft sequentially with delay (rate limiting)
      for (let i = 0; i < aircraft.length; i++) {
        const plane = aircraft[i];

        try {
          // Skip if we just cached this recently (check DB)
          const cacheKey = plane.callsign || plane.icao24;
          const existingRoute = await postgresRepository.getCachedRoute(cacheKey);

          if (existingRoute) {
            logger.debug(`Skipping ${cacheKey} - already in cache`);
            continue;
          }

          logger.info(`Background fetch: ${cacheKey} (${i + 1}/${aircraft.length})`);

          // Fetch route (will use AviationStack + inference, FlightAware is disabled)
          await flightRouteService.getFlightRoute(
            plane.icao24,
            plane.callsign,
            true, // isCurrentFlight
          );

          // Small delay between requests to be respectful to APIs
          if (i < aircraft.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
          }
        } catch (error) {
          logger.error('Error processing aircraft in background job', {
            icao24: plane.icao24,
            callsign: plane.callsign,
            error: error.message,
          });
          // Continue with next aircraft even if one fails
        }
      }

      logger.info('Background route job completed', {
        processed: aircraft.length,
      });
    } catch (error) {
      logger.error('Error in background route processing', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Backfill older flights with missing times/aircraft using APIs (rate-limited)
   */
  async backfillFlightHistorySample() {
    try {
      const flights = await postgresRepository.findFlightsNeedingBackfill(this.BACKFILL_BATCH);
      if (flights.length === 0) {
        logger.info('Backfill: no flights need enrichment');
        return;
      }

      logger.info(`Backfill: enriching ${flights.length} flights`);

      let flightAwareRemaining = this.FLIGHTAWARE_CALLS_CAP;
      for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        try {
          const before = {
            sched_start: f.scheduled_flight_start,
            sched_end: f.scheduled_flight_end,
            actual_start: f.actual_flight_start,
            actual_end: f.actual_flight_end,
            first_seen: f.first_seen,
            last_seen: f.last_seen,
            aircraft_type: f.aircraft_type,
          };

          // Prefer OpenSky (free) for historical flights, then FlightAware, then AviationStack
          let route = null;
          if (f.icao24) {
            try { route = await flightRouteService.fetchRouteFromOpenSky(f.icao24, false); } catch (e) { /* noop */ }
            // Respect OpenSky rate limits
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          if (!route && f.callsign && flightAwareRemaining > 0) {
            // Use the flight's created_at date to improve historical actuals
            const dateStr = new Date(f.created_at).toISOString().split('T')[0];
            try {
              route = await flightRouteService.fetchRouteFromFlightAware(f.callsign, dateStr);
            } catch (e) { /* noop */ } finally {
              flightAwareRemaining -= 1;
            }
          }
          if (!route && f.callsign) {
            try { route = await flightRouteService.fetchRouteFromAPI(f.icao24, f.callsign); } catch (e) { /* noop */ }
          }

          const updates = {};
          if (route?.flightData) {
            const fd = route.flightData;
            if (fd.firstSeen) updates.first_seen = fd.firstSeen;
            if (fd.lastSeen) updates.last_seen = fd.lastSeen;
            if (fd.scheduledDeparture) updates.scheduled_flight_start = new Date(fd.scheduledDeparture * 1000);
            if (fd.scheduledArrival) updates.scheduled_flight_end = new Date(fd.scheduledArrival * 1000);
            if (fd.actualDeparture) updates.actual_flight_start = new Date(fd.actualDeparture * 1000);
            if (fd.actualArrival) updates.actual_flight_end = new Date(fd.actualArrival * 1000);
            if (typeof fd.duration === 'number') updates.ete = fd.duration;
          }
          // Compute ETEs if timestamps present
          if (updates.scheduled_flight_start && updates.scheduled_flight_end) {
            updates.scheduled_ete = Math.max(0, Math.floor((updates.scheduled_flight_end - updates.scheduled_flight_start) / 1000));
          }
          if (updates.actual_flight_start && updates.actual_flight_end) {
            updates.actual_ete = Math.max(0, Math.floor((updates.actual_flight_end - updates.actual_flight_start) / 1000));
            if (!updates.ete) updates.ete = updates.actual_ete;
          }
          // Capture aircraft type/model if present
          if (route?.aircraft?.type && !updates.aircraft_type) updates.aircraft_type = route.aircraft.type;
          if (route?.aircraft?.model && !updates.aircraft_model) updates.aircraft_model = route.aircraft.model;
          if (route?.aircraft?.type || route?.aircraft_type) {
            updates.aircraft_type = route.aircraft?.type || route.aircraft_type;
          }
          if (route?.aircraft?.model || route?.aircraft_model) {
            updates.aircraft_model = route.aircraft?.model || route.aircraft_model;
          }

          if (Object.keys(updates).length > 0) {
            await postgresRepository.updateFlightHistoryById(f.id, updates);
            logger.info('Backfill: updated flight', { id: f.id, before, after: updates });
          }

          // Small inter-flight delay
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          logger.warn('Backfill: failed to enrich flight', { id: f.id, error: error.message });
        }
      }
    } catch (error) {
      logger.error('Backfill job failed', { error: error.message });
    }
  }

  /**
   * Backfill flights within a date range (inclusive start, inclusive end date strings YYYY-MM-DD)
   */
  async backfillFlightsInRange(startDate, endDate, limit = 50) {
    try {
      const flights = await postgresRepository.findFlightsNeedingBackfillInRange(startDate, endDate, limit);
      if (flights.length === 0) {
        logger.info('Backfill(range): no flights need enrichment', { startDate, endDate });
        return;
      }

      logger.info('Backfill(range): enriching flights', { startDate, endDate, count: flights.length });

      let flightAwareRemaining = this.FLIGHTAWARE_CALLS_CAP;
      for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        try {
          let route = null;
          // OpenSky first (historical)
          if (f.icao24) {
            try { route = await flightRouteService.fetchRouteFromOpenSky(f.icao24, false); } catch (e) { /* noop */ }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          // FlightAware with date
          if (!route && f.callsign && flightAwareRemaining > 0) {
            const dateStr = new Date(f.created_at).toISOString().split('T')[0];
            try {
              route = await flightRouteService.fetchRouteFromFlightAware(f.callsign, dateStr);
            } catch (e) { /* noop */ } finally {
              flightAwareRemaining -= 1;
            }
          }
          // AviationStack fallback
          if (!route && f.callsign) {
            try { route = await flightRouteService.fetchRouteFromAPI(f.icao24, f.callsign); } catch (e) { /* noop */ }
          }

          const updates = {};
          if (route?.flightData) {
            const fd = route.flightData;
            if (fd.firstSeen) updates.first_seen = fd.firstSeen;
            if (fd.lastSeen) updates.last_seen = fd.lastSeen;
            if (fd.scheduledDeparture) updates.scheduled_flight_start = new Date(fd.scheduledDeparture * 1000);
            if (fd.scheduledArrival) updates.scheduled_flight_end = new Date(fd.scheduledArrival * 1000);
            if (fd.actualDeparture) updates.actual_flight_start = new Date(fd.actualDeparture * 1000);
            if (fd.actualArrival) updates.actual_flight_end = new Date(fd.actualArrival * 1000);
            if (typeof fd.duration === 'number') updates.ete = fd.duration;
          }
          if (updates.scheduled_flight_start && updates.scheduled_flight_end) {
            updates.scheduled_ete = Math.max(0, Math.floor((updates.scheduled_flight_end - updates.scheduled_flight_start) / 1000));
          }
          if (updates.actual_flight_start && updates.actual_flight_end) {
            updates.actual_ete = Math.max(0, Math.floor((updates.actual_flight_end - updates.actual_flight_start) / 1000));
            if (!updates.ete) updates.ete = updates.actual_ete;
          }
          if (route?.aircraft?.type && !updates.aircraft_type) updates.aircraft_type = route.aircraft.type;
          if (route?.aircraft?.model && !updates.aircraft_model) updates.aircraft_model = route.aircraft.model;
          if (route?.aircraft?.type || route?.aircraft_type) {
            updates.aircraft_type = route.aircraft?.type || route.aircraft_type;
          }
          if (route?.aircraft?.model || route?.aircraft_model) {
            updates.aircraft_model = route.aircraft?.model || route.aircraft_model;
          }

          if (Object.keys(updates).length > 0) {
            await postgresRepository.updateFlightHistoryById(f.id, updates);
            logger.info('Backfill(range): updated', { id: f.id });
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          logger.warn('Backfill(range): failed to enrich', { id: f.id, error: error.message });
        }
      }
    } catch (error) {
      logger.error('Backfill(range) job failed', { error: error.message, startDate, endDate });
    }
  }

  /**
   * Backfill a subset of recent flights missing all actual/scheduled fields
   */
  async backfillFlightsMissingAll(limit = 50, flightAwareCap = 100) {
    try {
      const flights = await postgresRepository.findFlightsMissingAllRecent(limit);
      if (flights.length === 0) {
        logger.info('Backfill(subset): none missing all fields');
        return;
      }
      logger.info('Backfill(subset): enriching flights', { count: flights.length });

      let flightAwareRemaining = flightAwareCap;
      for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        try {
          let route = null;
          if (f.icao24) {
            try { route = await flightRouteService.fetchRouteFromOpenSky(f.icao24, false); } catch (e) { /* noop */ }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          if (!route && f.callsign && flightAwareRemaining > 0) {
            const dateStr = new Date(f.created_at).toISOString().split('T')[0];
            try { route = await flightRouteService.fetchRouteFromFlightAware(f.callsign, dateStr); } catch (e) { /* noop */ } finally { flightAwareRemaining -= 1; }
          }
          if (!route && f.callsign) {
            try { route = await flightRouteService.fetchRouteFromAPI(f.icao24, f.callsign); } catch (e) { /* noop */ }
          }

          const updates = {};
          if (route?.flightData) {
            const fd = route.flightData;
            if (fd.firstSeen) updates.first_seen = fd.firstSeen;
            if (fd.lastSeen) updates.last_seen = fd.lastSeen;
            if (fd.scheduledDeparture) updates.scheduled_flight_start = new Date(fd.scheduledDeparture * 1000);
            if (fd.scheduledArrival) updates.scheduled_flight_end = new Date(fd.scheduledArrival * 1000);
            if (fd.actualDeparture) updates.actual_flight_start = new Date(fd.actualDeparture * 1000);
            if (fd.actualArrival) updates.actual_flight_end = new Date(fd.actualArrival * 1000);
            if (typeof fd.duration === 'number') updates.ete = fd.duration;
          }
          if (updates.scheduled_flight_start && updates.scheduled_flight_end) {
            updates.scheduled_ete = Math.max(0, Math.floor((updates.scheduled_flight_end - updates.scheduled_flight_start) / 1000));
          }
          if (updates.actual_flight_start && updates.actual_flight_end) {
            updates.actual_ete = Math.max(0, Math.floor((updates.actual_flight_end - updates.actual_flight_start) / 1000));
            if (!updates.ete) updates.ete = updates.actual_ete;
          }
          if (route?.aircraft?.type && !updates.aircraft_type) updates.aircraft_type = route.aircraft.type;
          if (route?.aircraft?.model && !updates.aircraft_model) updates.aircraft_model = route.aircraft.model;
          if (Object.keys(updates).length > 0) {
            await postgresRepository.updateFlightHistoryById(f.id, updates);
            logger.info('Backfill(subset): updated', { id: f.id });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          logger.warn('Backfill(subset): failed', { id: f.id, error: err.message });
        }
      }
    } catch (error) {
      logger.error('Backfill(subset) job failed', { error: error.message });
    }
  }
}

// Create singleton instance
const backgroundRouteService = new BackgroundRouteService();

module.exports = backgroundRouteService;
