import postgresRepository from '../repositories/PostgresRepository';
import flightRouteService from './FlightRouteService';
import logger from '../utils/logger';
import { mapAircraftTypeToCategory } from '../utils/aircraftCategoryMapper';

/**
 * Background service to periodically populate route database
 * Runs at a slow rate to avoid API rate limits and costs
 */
class BackgroundRouteService {
  private isRunning: boolean = false;

  private intervalId: NodeJS.Timeout | null = null;

  private readonly BATCH_SIZE: number = 5;

  private readonly INTERVAL_MS: number = 5 * 60 * 1000; // 5 minutes

  private readonly BACKFILL_BATCH: number = 10;

  private readonly FLIGHTAWARE_CALLS_CAP: number;

  constructor() {
    this.FLIGHTAWARE_CALLS_CAP = parseInt(process.env.FA_BACKFILL_CAP || '50', 10);
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Background route service is already running');
      return;
    }

    logger.info('Starting background route population service', {
      batchSize: this.BATCH_SIZE,
      intervalMinutes: this.INTERVAL_MS / (60 * 1000),
    });

    this.isRunning = true;
    this.processRoutes();

    this.intervalId = setInterval(() => {
      this.processRoutes();
    }, this.INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('Background route population service stopped');
  }

  async processRoutes(): Promise<void> {
    try {
      logger.debug('Background route job starting', { batchSize: this.BATCH_SIZE });

      const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
      const aircraft = await postgresRepository.findRecentAircraftWithoutRoutes(
        tenMinutesAgo,
        this.BATCH_SIZE,
      );

      if (aircraft.length === 0) {
        logger.debug('No aircraft need route data at this time');
        return;
      }

      logger.debug(`Processing ${aircraft.length} aircraft for background route population`);

      for (let i = 0; i < aircraft.length; i++) {
        const plane = aircraft[i];

        try {
          const cacheKey = plane.callsign || plane.icao24;
          const existingRoute = await postgresRepository.getCachedRoute(cacheKey);

          if (existingRoute) {
            logger.debug(`Skipping ${cacheKey} - already in cache`);
            continue;
          }

          logger.debug(`Background fetch: ${cacheKey} (${i + 1}/${aircraft.length})`);

          await flightRouteService.getFlightRoute(
            plane.icao24,
            plane.callsign,
            true,
          );

          if (i < aircraft.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        } catch (error) {
          const err = error as Error;
          logger.error('Error processing aircraft in background job', {
            icao24: plane.icao24,
            callsign: plane.callsign,
            error: err.message,
          });
        }
      }

      logger.debug('Background route job completed', {
        processed: aircraft.length,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Error in background route processing', {
        error: err.message,
        stack: err.stack,
      });
    }
  }

  /**
   * Fetch route data for a flight from available APIs
   * Returns route object or null
   */
  private async _fetchRouteForFlight(
    flight: any,
    flightAwareRemaining: number,
    logContext: string = '',
  ): Promise<{ route: any | null; flightAwareRemaining: number }> {
    let route: any | null = null;
    let faRemaining = flightAwareRemaining;

    // Skip OpenSky in backfill jobs to preserve API quota for real-time tracking
    // OpenSky is heavily rate-limited and should only be used for live aircraft data
    // Background jobs use FlightAware instead

    // Try FlightAware ($$, best data but rate-limited)
    if (!route && flight.callsign && faRemaining > 0) {
      const dateStr = new Date(flight.created_at).toISOString().split('T')[0];
      try {
        logger.debug(`Calling FlightAware API ${logContext}`, {
          callsign: flight.callsign,
          date: dateStr,
          remaining: faRemaining,
        });

        const routeResult = await flightRouteService.fetchRouteFromFlightAware(flight.callsign, dateStr);

        if (routeResult) {
          const routes = Array.isArray(routeResult) ? routeResult : [routeResult];

          // Store all flights from FlightAware response
          for (const faRoute of routes) {
            try {
              await postgresRepository.storeRouteHistory({
                ...faRoute,
                callsign: flight.callsign,
                icao24: flight.icao24,
                source: 'flightaware',
              });
            } catch (storeErr) {
              const err = storeErr as Error;
              if (!err.message?.includes('duplicate key')) {
                logger.warn('Failed to store FlightAware flight', { error: err.message });
              }
            }
          }

          route = routes[0];
          logger.info(`FlightAware API call successful ${logContext}`, {
            callsign: flight.callsign,
            flightsFound: routes.length,
            remaining: faRemaining - 1,
          });
        } else {
          logger.debug(`FlightAware returned no data ${logContext}`, { callsign: flight.callsign });
        }
        faRemaining -= 1;
      } catch (e) {
        faRemaining -= 1;
        const err = e as Error;
        logger.warn(`FlightAware API call failed ${logContext}`, {
          callsign: flight.callsign,
          error: err.message,
          remaining: faRemaining,
        });
      }
    } else if (!route && flight.callsign && faRemaining <= 0) {
      logger.debug(`Skipping FlightAware ${logContext} - cap reached`, { callsign: flight.callsign });
    }

    return { route, flightAwareRemaining: faRemaining };
  }

  /**
   * Extract update fields from route data
   */
  private _extractUpdateFields(route: any): any {
    const updates: any = {};

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

    // Compute ETEs
    if (updates.scheduled_flight_start && updates.scheduled_flight_end) {
      updates.scheduled_ete = Math.max(0, Math.floor((updates.scheduled_flight_end.getTime() - updates.scheduled_flight_start.getTime()) / 1000));
    }
    if (updates.actual_flight_start && updates.actual_flight_end) {
      updates.actual_ete = Math.max(0, Math.floor((updates.actual_flight_end.getTime() - updates.actual_flight_start.getTime()) / 1000));
      if (!updates.ete) updates.ete = updates.actual_ete;
    }

    // Aircraft type/model
    if (route?.aircraft?.type && !updates.aircraft_type) updates.aircraft_type = route.aircraft.type;
    if (route?.aircraft?.model && !updates.aircraft_model) updates.aircraft_model = route.aircraft.model;

    // FlightAware additional fields
    if (route?.registration) updates.registration = route.registration;
    if (route?.flightStatus) updates.flight_status = route.flightStatus;
    if (route?.route) updates.route = route.route;
    if (route?.routeDistance) updates.route_distance = route.routeDistance;
    if (route?.baggageClaim) updates.baggage_claim = route.baggageClaim;
    if (route?.gateOrigin) updates.gate_origin = route.gateOrigin;
    if (route?.gateDestination) updates.gate_destination = route.gateDestination;
    if (route?.terminalOrigin) updates.terminal_origin = route.terminalOrigin;
    if (route?.terminalDestination) updates.terminal_destination = route.terminalDestination;
    if (route?.actualRunwayOff) updates.actual_runway_off = route.actualRunwayOff;
    if (route?.actualRunwayOn) updates.actual_runway_on = route.actualRunwayOn;
    if (route?.progressPercent !== undefined) updates.progress_percent = route.progressPercent;
    if (route?.filedAirspeed) updates.filed_airspeed = route.filedAirspeed;
    if (route?.blocked !== undefined) updates.blocked = route.blocked;
    if (route?.diverted !== undefined) updates.diverted = route.diverted;
    if (route?.cancelled !== undefined) updates.cancelled = route.cancelled;
    if (route?.departureDelay !== undefined) updates.departure_delay = route.departureDelay;
    if (route?.arrivalDelay !== undefined) updates.arrival_delay = route.arrivalDelay;

    if (route?.aircraft?.type || route?.aircraft_type) {
      updates.aircraft_type = route.aircraft?.type || route.aircraft_type;
    }
    if (route?.aircraft?.model || route?.aircraft_model) {
      updates.aircraft_model = route.aircraft?.model || route.aircraft_model;
    }

    return updates;
  }

  /**
   * Update aircraft category based on type/model
   */
  private async _updateAircraftCategory(icao24: string, route: any, updates: any): Promise<void> {
    if (!icao24 || (!route?.aircraft?.type && !route?.aircraft?.model && !updates.aircraft_type && !updates.aircraft_model)) {
      return;
    }

    const aircraftType = route?.aircraft?.type || updates.aircraft_type;
    const aircraftModel = route?.aircraft?.model || updates.aircraft_model;
    const inferredCategory = mapAircraftTypeToCategory(aircraftType, aircraftModel);

    if (inferredCategory !== null) {
      try {
        await postgresRepository.updateAircraftCategory(icao24, inferredCategory);
        logger.debug('Updated aircraft category from type/model', {
          icao24,
          type: aircraftType,
          model: aircraftModel,
          category: inferredCategory,
        });
      } catch (err) {
        const error = err as Error;
        logger.warn('Failed to update aircraft category', { error: error.message });
      }
    }
  }

  /**
   * Process a single flight for backfill
   */
  private async _processFlightBackfill(
    flight: any,
    flightAwareRemaining: number,
    logContext: string = '',
  ): Promise<number> {
    const { route, flightAwareRemaining: faRemaining } = await this._fetchRouteForFlight(
      flight,
      flightAwareRemaining,
      logContext,
    );

    const updates = this._extractUpdateFields(route);
    await this._updateAircraftCategory(flight.icao24, route, updates);

    if (Object.keys(updates).length > 0) {
      await postgresRepository.updateFlightHistoryById(flight.id, updates);
      logger.info(`Backfill ${logContext}: updated flight`, { id: flight.id });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    return faRemaining;
  }

  /**
   * Backfill older flights with missing data
   */
  async backfillFlightHistorySample(): Promise<void> {
    try {
      const flights = await postgresRepository.findFlightsNeedingBackfill(this.BACKFILL_BATCH);
      if (flights.length === 0) {
        logger.info('Backfill: no flights need enrichment');
        return;
      }

      logger.info(`Backfill: enriching ${flights.length} flights`, {
        flightAwareCap: this.FLIGHTAWARE_CALLS_CAP,
      });

      let flightAwareRemaining = this.FLIGHTAWARE_CALLS_CAP;
      for (const flight of flights) {
        try {
          flightAwareRemaining = await this._processFlightBackfill(flight, flightAwareRemaining, '');
        } catch (error) {
          const err = error as Error;
          logger.warn('Backfill: failed to enrich flight', { id: flight.id, error: err.message });
        }
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Backfill job failed', { error: err.message });
    }
  }

  /**
   * Backfill flights within a date range
   */
  async backfillFlightsInRange(startDate: string, endDate: string, limit: number = 50): Promise<void> {
    try {
      const flights = await postgresRepository.findFlightsNeedingBackfillInRange(startDate, endDate, limit);
      if (flights.length === 0) {
        logger.info('Backfill(range): no flights need enrichment', { startDate, endDate });
        return;
      }

      logger.info('Backfill(range): enriching flights', {
        startDate,
        endDate,
        count: flights.length,
        flightAwareCap: this.FLIGHTAWARE_CALLS_CAP,
      });

      let flightAwareRemaining = this.FLIGHTAWARE_CALLS_CAP;
      for (const flight of flights) {
        try {
          flightAwareRemaining = await this._processFlightBackfill(flight, flightAwareRemaining, '(range)');
        } catch (error) {
          const err = error as Error;
          logger.warn('Backfill(range): failed to enrich', { id: flight.id, error: err.message });
        }
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Backfill(range) job failed', { error: err.message, startDate, endDate });
    }
  }

  /**
   * Backfill flights missing all actual/scheduled fields
   */
  async backfillFlightsMissingAll(limit: number = 50, flightAwareCap: number = 100): Promise<void> {
    try {
      const flights = await postgresRepository.findFlightsMissingAllRecent(limit);
      if (flights.length === 0) {
        logger.info('Backfill(subset): none missing all fields');
        return;
      }

      logger.info('Backfill(subset): enriching flights', {
        count: flights.length,
        flightAwareCap,
      });

      let flightAwareRemaining = flightAwareCap;
      for (const flight of flights) {
        try {
          flightAwareRemaining = await this._processFlightBackfill(flight, flightAwareRemaining, '(subset)');
        } catch (error) {
          const err = error as Error;
          logger.warn('Backfill(subset): failed', { id: flight.id, error: err.message });
        }
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Backfill(subset) job failed', { error: err.message });
    }
  }
}

// Export singleton instance
const backgroundRouteService = new BackgroundRouteService();
export default backgroundRouteService;
