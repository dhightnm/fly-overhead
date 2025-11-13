import postgresRepository from '../repositories/PostgresRepository';
import openSkyService from './OpenSkyService';
import trajectoryPredictionService from './TrajectoryPredictionService';
import webSocketService from './WebSocketService';
import rateLimitManager from './RateLimitManager';
import aerodataboxService from './AerodataboxService';
import flightRouteService from './FlightRouteService';
import config from '../config';
import logger from '../utils/logger';
import { mapAircraftType } from '../utils/aircraftCategoryMapper';
import { initializeAirportSchema } from '../database/airportSchema';

interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

interface RateLimitError extends Error {
  rateLimited?: boolean;
  retryAfter?: number | null;
}

/**
 * Business logic layer for aircraft operations
 * Orchestrates repository and external service calls
 */
class AircraftService {
  /**
   * Fetch all aircraft and update database
   */
  async fetchAndUpdateAllAircraft(): Promise<any[]> {
    try {
      logger.info('Fetching all aircraft from OpenSky');
      const data = await openSkyService.getAllStates();

      if (!data.states || data.states.length === 0) {
        logger.warn('No aircraft states returned from OpenSky');
        return [];
      }

      logger.info(`Processing ${data.states.length} aircraft states`);

      const BATCH_SIZE = 50;
      let processed = 0;

      for (let i = 0; i < data.states.length; i += BATCH_SIZE) {
        const batch = data.states.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((state: any[]) => {
          const preparedState = openSkyService.prepareStateForDatabase(state);
          // Use priority system: OpenSky has priority 30 (lower = higher priority)
          // Feeder has priority 10 (high priority), so feeder data is preferred
          return postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);
        });

        await Promise.all(batchPromises);
        processed += batch.length;

        if ((i / BATCH_SIZE) % 5 === 0) {
          logger.debug(`Processed ${processed}/${data.states.length} aircraft`);
        }

        if (i + BATCH_SIZE < data.states.length) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      logger.info(`Database updated successfully with all ${processed} aircraft`);

      // Clear bounds cache so fresh data is returned on next request
      // Use dynamic import to avoid circular dependency
      try {
        const aircraftRoutes = await import('../routes/aircraft.routes');
        if (aircraftRoutes && aircraftRoutes.boundsCache) {
          aircraftRoutes.boundsCache.flushAll();
          logger.info('Cleared bounds cache after OpenSky update');
        } else {
          logger.warn('boundsCache not found in aircraft.routes module');
        }
      } catch (err) {
        const error = err as Error;
        logger.error('Failed to clear bounds cache', { error: error.message, stack: error.stack });
      }

      webSocketService.getIO()?.emit('aircraft:global_update', {
        timestamp: new Date().toISOString(),
        message: 'Aircraft data updated',
      });

      return data.states;
    } catch (error) {
      const err = error as RateLimitError;
      // Check if it's a rate limit error
      if (err.rateLimited) {
        logger.warn('OpenSky fetch skipped due to rate limiting', {
          retryAfter: err.retryAfter,
          retryAt: err.retryAfter ? new Date(Date.now() + err.retryAfter * 1000).toISOString() : null,
        });
        // Don't throw - just skip this fetch cycle
        return [];
      }

      logger.error('Error in fetchAndUpdateAllAircraft', { error: err.message });
      throw error;
    }
  }

  /**
   * Fetch and update aircraft for specific bounding box
   * Uses OpenSky API for geographic bounds queries
   */
  async fetchAndUpdateAircraftInBounds(boundingBox: BoundingBox): Promise<any[]> {
    try {
      logger.info('Fetching aircraft in bounding box', { boundingBox });

      const data = await openSkyService.getStatesInBounds(boundingBox);

      if (!data.states || data.states.length === 0) {
        logger.info('No aircraft in specified bounds');
        return [];
      }

      logger.info(`Processing ${data.states.length} aircraft in bounds from OpenSky`);

      // Debug: Log a sample aircraft to verify data
      if (data.states.length > 0) {
        const sampleState = data.states[0];
        logger.debug('Sample bounded aircraft from OpenSky', {
          icao24: sampleState[0],
          callsign: sampleState[1],
          last_contact: sampleState[4],
          last_contact_age_seconds: Math.floor(Date.now() / 1000) - sampleState[4],
        });
      }

      const statePromises = data.states.map((state: any[]) => {
        const preparedState = openSkyService.prepareStateForDatabase(state);
        // Use priority system: OpenSky has priority 30 (lower = higher priority)
        // Feeder has priority 10 (high priority), so feeder data is preferred
        return postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);
      });

      await Promise.all(statePromises);
      logger.info('Database updated with bounded aircraft from OpenSky');

      // Clear bounds cache so fresh data is returned on next request
      // Use dynamic import to avoid circular dependency
      try {
        const aircraftRoutes = await import('../routes/aircraft.routes');
        if (aircraftRoutes && aircraftRoutes.boundsCache) {
          aircraftRoutes.boundsCache.flushAll();
          logger.info('Cleared bounds cache after bounded OpenSky update');
        } else {
          logger.warn('boundsCache not found in aircraft.routes module');
        }
      } catch (err) {
        const error = err as Error;
        logger.error('Failed to clear bounds cache', { error: error.message, stack: error.stack });
      }

      return data.states;
    } catch (error) {
      const err = error as RateLimitError;
      // Check if it's a rate limit error
      if (err.rateLimited) {
        logger.warn('OpenSky bounded fetch skipped due to rate limiting', {
          boundingBox,
          retryAfter: err.retryAfter,
        });
        // Don't throw - just return empty array to allow app to continue
        return [];
      }

      logger.error('Error in fetchAndUpdateAircraftInBounds', {
        boundingBox,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get aircraft by identifier (icao24 or callsign)
   * Fetches fresh data from OpenSky if database data is stale (>30 seconds old)
   */
  async getAircraftByIdentifier(identifier: string): Promise<any | null> {
    try {
      logger.info(`Searching for aircraft: ${identifier} (checking database)`);

      // Query database directly instead of calling OpenSky getAllStates()
      // This avoids fetching 6000+ aircraft just to find one
      const results = await postgresRepository.findAircraftByIdentifier(identifier);

      if (results.length === 0) {
        logger.info(`No aircraft found for identifier: ${identifier}`);
        return null;
      }

      const aircraft = results[0];
      const now = Math.floor(Date.now() / 1000);
      const lastContact = typeof aircraft.last_contact === 'number' ? aircraft.last_contact : null;
      const dataAgeSeconds = lastContact !== null ? now - lastContact : null;
      const STALE_THRESHOLD_SECONDS = 10 * 60; // Consider data stale if older than 10 minutes
      const FRESH_FETCH_WINDOW_SECONDS = 15 * 60; // Only attempt expensive refresh for data newer than 15 minutes
      const shouldAttemptGlobalFetch = dataAgeSeconds !== null && dataAgeSeconds <= FRESH_FETCH_WINDOW_SECONDS;
      const isStale = dataAgeSeconds === null ? true : dataAgeSeconds > STALE_THRESHOLD_SECONDS;

      if (dataAgeSeconds !== null) {
        aircraft.data_age_seconds = dataAgeSeconds;
        aircraft.last_update_age_seconds = dataAgeSeconds;
      }

      logger.info(`Found aircraft in database for identifier: ${identifier}`, {
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
        last_contact: aircraft.last_contact,
        dataAgeSeconds,
        isStale,
      });

      if (isStale) {
        aircraft.isStale = true;
        if (!aircraft.staleReason) {
          aircraft.staleReason = 'stale-database';
        }
      }

      // If data is stale, try to fetch fresh data from OpenSky
      if (isStale) {
        logger.info(`Aircraft data is stale (${dataAgeSeconds}s old), fetching fresh data from OpenSky`, {
          icao24: aircraft.icao24,
          identifier,
        });

        try {
          // Check if we're rate limited before attempting fetch
          if (rateLimitManager.isRateLimited()) {
            const secondsRemaining = rateLimitManager.getSecondsUntilRetry();
            logger.warn('OpenSky API rate limited, returning stale data', {
              identifier,
              retryAfter: secondsRemaining,
            });
            return aircraft; // Return stale data if rate limited
          }

          // Use bounding box query if we have position data. Only fall back to global fetch when data is still relatively fresh.
          let openSkyData;
          let attemptedGlobalFetch = false;

          if (aircraft.latitude && aircraft.longitude) {
            // Create a small bounding box around the aircraft's last known position
            // Use 2 degrees (~220km) in each direction to account for aircraft movement
            const boxSize = 2.0;
            const bounds: BoundingBox = {
              lamin: aircraft.latitude - boxSize,
              lomin: aircraft.longitude - boxSize,
              lamax: aircraft.latitude + boxSize,
              lomax: aircraft.longitude + boxSize,
            };

            logger.info(`Fetching aircraft in bounding box around last known position`, {
              icao24: aircraft.icao24,
              bounds,
            });

            try {
              openSkyData = await openSkyService.getStatesInBounds(bounds);
            } catch (boundsError) {
              const boundsErr = boundsError as Error;
              if (shouldAttemptGlobalFetch) {
                logger.warn('Bounding box query failed, falling back to getAllStates (within freshness window)', {
                  error: boundsErr.message,
                  icao24: aircraft.icao24,
                });
                openSkyData = await openSkyService.getAllStates();
                attemptedGlobalFetch = true;
              } else {
                logger.info('Bounding box query failed but data too old for global fetch', {
                  error: boundsErr.message,
                  icao24: aircraft.icao24,
                });
              }
            }

            if (
              (!openSkyData || !openSkyData.states || openSkyData.states.length === 0) &&
              shouldAttemptGlobalFetch &&
              !attemptedGlobalFetch
            ) {
              logger.info('Bounding box query returned no states, attempting global fetch within freshness window', {
                icao24: aircraft.icao24,
              });
              openSkyData = await openSkyService.getAllStates();
              attemptedGlobalFetch = true;
            }
          } else if (shouldAttemptGlobalFetch) {
            logger.info(`No position data available, using getAllStates`, {
              icao24: aircraft.icao24,
            });
            openSkyData = await openSkyService.getAllStates();
            attemptedGlobalFetch = true;
          } else {
            logger.info('Skipping OpenSky global fetch (no position data and aircraft is very stale)', {
              icao24: aircraft.icao24,
              dataAgeSeconds,
            });
          }

          if (openSkyData && openSkyData.states && openSkyData.states.length > 0) {
            // Find the specific aircraft in the OpenSky response
            const lowerIdentifier = identifier.toLowerCase().trim();
            const matchingState = openSkyData.states.find((state: any[]) => {
              const stateIcao24 = state[0]?.toLowerCase();
              const stateCallsign = state[1]?.toLowerCase();
              return stateIcao24 === lowerIdentifier || stateCallsign === lowerIdentifier;
            });

            if (matchingState) {
              const openSkyCallsign = matchingState[1]; // Index 1 is callsign in OpenSky state
              logger.info(`Found fresh data for aircraft in OpenSky response`, {
                icao24: matchingState[0],
                callsign: openSkyCallsign,
              });

              // Prepare and update database with fresh data
              const preparedState = openSkyService.prepareStateForDatabase(matchingState);
              await postgresRepository.upsertAircraftStateWithPriority(preparedState, null, new Date(), 'opensky', 30);

              // If OpenSky has a callsign and aircraft doesn't, update it
              if (openSkyCallsign && (!aircraft.callsign || aircraft.callsign.trim() === '')) {
                try {
                  await postgresRepository.updateAircraftCallsign(aircraft.icao24, openSkyCallsign);
                  logger.info('Updated aircraft callsign from OpenSky', {
                    icao24: aircraft.icao24,
                    callsign: openSkyCallsign,
                  });
                } catch (err) {
                  const error = err as Error;
                  logger.warn('Failed to update aircraft callsign from OpenSky', { error: error.message });
                }
              }

              // Fetch updated aircraft from database
              const updatedResults = await postgresRepository.findAircraftByIdentifier(identifier);
              if (updatedResults.length > 0) {
                const refreshedAircraft = updatedResults[0];
                const refreshedLastContact =
                  typeof refreshedAircraft.last_contact === 'number' ? refreshedAircraft.last_contact : null;
                const refreshedAgeSeconds =
                  refreshedLastContact !== null
                    ? Math.max(0, Math.floor(Date.now() / 1000) - refreshedLastContact)
                    : null;
                if (refreshedAgeSeconds !== null) {
                  refreshedAircraft.data_age_seconds = refreshedAgeSeconds;
                  refreshedAircraft.last_update_age_seconds = refreshedAgeSeconds;
                }

                logger.info(`Returning fresh aircraft data`, {
                  icao24: refreshedAircraft.icao24,
                  callsign: refreshedAircraft.callsign,
                  last_contact: refreshedAircraft.last_contact,
                  dataAgeSeconds: refreshedAgeSeconds,
                });
                return refreshedAircraft;
              }
            } else {
              logger.info(`Aircraft not found in OpenSky response (likely landed or out of range)`, {
                identifier,
                icao24: aircraft.icao24,
              });
              // Aircraft not in OpenSky - likely landed or out of range
              // Return database data (which may be stale but is the best we have)
            }
          }
        } catch (error) {
          const err = error as Error;
          // Check if it's a rate limit error
          if ((err as any).rateLimited) {
            logger.warn('OpenSky fetch failed due to rate limiting, returning stale data', {
              identifier,
              retryAfter: (err as any).retryAfter,
            });
          } else {
            logger.warn('Failed to fetch fresh data from OpenSky, returning stale data', {
              identifier,
              error: err.message,
            });
          }
          // Return stale data if fetch fails
        }
      }

      return aircraft;
    } catch (error) {
      const err = error as Error;
      logger.error('Error in getAircraftByIdentifier', {
        identifier,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Enrich aircraft data with route information and model/type
   * Takes raw database result (with JOINed route data) and formats it for frontend
   */
  private _enrichAircraftWithRoute(aircraft: any): any {
    const enriched = { ...aircraft };

    // Extract route data if available
    const hasRouteData =
      aircraft.departure_icao ||
      aircraft.departure_iata ||
      aircraft.arrival_icao ||
      aircraft.arrival_iata ||
      aircraft.aircraft_type;

    if (hasRouteData) {
      // Build route object
      enriched.route = {
        departureAirport:
          aircraft.departure_icao || aircraft.departure_iata
            ? {
                icao: aircraft.departure_icao || null,
                iata: aircraft.departure_iata || null,
                name: aircraft.departure_name || null,
              }
            : null,
        arrivalAirport:
          aircraft.arrival_icao || aircraft.arrival_iata
            ? {
                icao: aircraft.arrival_icao || null,
                iata: aircraft.arrival_iata || null,
                name: aircraft.arrival_name || null,
              }
            : null,
        source: aircraft.route_source || null,
      };

      // Enrich with aircraft model/type if aircraft_type is available
      if (aircraft.aircraft_type) {
        const aircraftInfo = mapAircraftType(aircraft.aircraft_type, aircraft.aircraft_model || null);
        enriched.route.aircraft = {
          type: aircraftInfo.type, // Display type (e.g., "Heavy", "Plane") - matches frontend expectation
          model: aircraftInfo.model, // Human-readable model (e.g., "737-800")
          category: aircraftInfo.category, // Category code for icon selection
        };

        // Update category in aircraft if not set or unreliable (0)
        // This ensures icons are correct on load
        if (aircraftInfo.category !== null && (enriched.category === null || enriched.category === 0)) {
          enriched.category = aircraftInfo.category;

          // Update category in database asynchronously (don't block response)
          postgresRepository.updateAircraftCategory(enriched.icao24, aircraftInfo.category).catch((err: Error) => {
            logger.debug('Failed to update aircraft category', {
              icao24: enriched.icao24,
              error: err.message,
            });
          });
        }
      }
    }

    // Clean up route-specific fields from main aircraft object
    delete enriched.departure_iata;
    delete enriched.departure_icao;
    delete enriched.departure_name;
    delete enriched.arrival_iata;
    delete enriched.arrival_icao;
    delete enriched.arrival_name;
    delete enriched.aircraft_type;
    delete enriched.route_source;
    delete enriched.route_created_at;

    return enriched;
  }

  /**
   * Get aircraft within geographical bounds (with trajectory prediction)
   * Uses route data to extrapolate positions between real API updates
   * Now includes route data from cache (no API call needed if cached)
   * In development mode when rate limited, shows stale aircraft with a flag
   */
  async getAircraftInBounds(latmin: number, lonmin: number, latmax: number, lonmax: number): Promise<any[]> {
    try {
      // Use a reasonable threshold - max 30 minutes for active flights
      // Extended thresholds (24 hours) are too permissive and show stale aircraft
      let contactThreshold = config.aircraft.recentContactThreshold; // 30 minutes default

      // Cap the threshold at 30 minutes even in dev mode to prevent showing hours-old aircraft
      // If we need to test with old data, we can use a separate test endpoint
      const MAX_REASONABLE_THRESHOLD = 30 * 60; // 30 minutes max
      if (contactThreshold > MAX_REASONABLE_THRESHOLD) {
        logger.warn('Capping contact threshold to prevent showing very old aircraft', {
          requested: contactThreshold,
          capped: MAX_REASONABLE_THRESHOLD,
        });
        contactThreshold = MAX_REASONABLE_THRESHOLD;
      }

      const thresholdTimestamp = Math.floor(Date.now() / 1000) - contactThreshold;

      const results = await postgresRepository.findAircraftInBounds(latmin, lonmin, latmax, lonmax, thresholdTimestamp);

      // Enrich with route data and model/type
      const enrichedWithRoutes = results.map((aircraft: any) => this._enrichAircraftWithRoute(aircraft));

      await this.enrichAircraftWithAerodatabox(enrichedWithRoutes);

      // Mark stale aircraft BEFORE trajectory prediction
      // This ensures the isStale flag is preserved when the prediction service creates new objects
      // Mark aircraft as stale if they're older than 15 minutes (more conservative than the 30-minute query threshold)
      const now = Math.floor(Date.now() / 1000);
      const STALE_THRESHOLD_SECONDS = 15 * 60; // 15 minutes - matches frontend filter

      enrichedWithRoutes.forEach((aircraft: any) => {
        if (aircraft.last_contact) {
          const ageSeconds = now - aircraft.last_contact;
          if (ageSeconds > STALE_THRESHOLD_SECONDS) {
            aircraft.isStale = true;
            aircraft.staleReason = aircraft.staleReason || 'stale-data';
            aircraft.ageMinutes = Math.floor(ageSeconds / 60);
            aircraft.data_age_seconds = ageSeconds;
            aircraft.last_update_age_seconds = ageSeconds;
          }
        }
      });

      // Filter out landed aircraft that are older than 15 minutes
      // These should not appear on the map as they've already landed
      const MAX_LANDED_AGE_SECONDS = 15 * 60; // 15 minutes
      const filteredAircraft = enrichedWithRoutes.filter((aircraft: any) => {
        // If aircraft is on ground and data is older than 15 minutes, filter it out
        if (aircraft.on_ground === true && aircraft.last_contact) {
          const ageSeconds = now - aircraft.last_contact;
          if (ageSeconds > MAX_LANDED_AGE_SECONDS) {
            logger.debug('Filtering out old landed aircraft', {
              icao24: aircraft.icao24,
              callsign: aircraft.callsign,
              ageSeconds,
              last_contact: new Date(aircraft.last_contact * 1000).toISOString(),
            });
            return false;
          }
        }
        return true;
      });

      // Apply position override for landed aircraft (similar to /planes/:identifier route)
      const LANDED_STATUSES = new Set(['arrived', 'landed', 'completed', 'diverted', 'cancelled']);
      const LANDED_OVERRIDE_THRESHOLD_SECONDS = 30 * 60; // 30 minutes
      const normalizeStatus = (status?: string | null): string | null => {
        if (!status || typeof status !== 'string') return null;
        return status.trim().toLowerCase();
      };

      filteredAircraft.forEach((aircraft: any) => {
        const route = aircraft.route;
        if (!route?.arrivalAirport?.location) return;

        const arrivalLocation = route.arrivalAirport.location;
        if (typeof arrivalLocation.lat !== 'number' || typeof arrivalLocation.lng !== 'number') return;

        const normalizedStatus = normalizeStatus(route.flightStatus);
        const hasArrivalStatus = normalizedStatus ? LANDED_STATUSES.has(normalizedStatus) : false;
        const actualArrivalTimestamp =
          typeof route.flightData?.actualArrival === 'number' ? route.flightData.actualArrival : null;
        const actualArrivalAgeSeconds = actualArrivalTimestamp ? Math.max(0, now - actualArrivalTimestamp) : null;
        const hasActualArrival = actualArrivalAgeSeconds !== null;
        const dataAgeSeconds =
          aircraft.data_age_seconds ?? (aircraft.last_contact ? Math.max(0, now - aircraft.last_contact) : null);
        const staleByAge = dataAgeSeconds !== null ? dataAgeSeconds > LANDED_OVERRIDE_THRESHOLD_SECONDS : false;

        if (hasArrivalStatus || hasActualArrival || staleByAge) {
          aircraft.latitude = arrivalLocation.lat;
          aircraft.longitude = arrivalLocation.lng;
          aircraft.on_ground = true;
          aircraft.velocity = 0;
          aircraft.true_track = null;
          aircraft.position_source = 'route-arrival';
          aircraft.isStale = true;
          aircraft.staleReason = hasArrivalStatus ? `flight_status:${normalizedStatus}` : 'route-arrival-inferred';
        }
      });

      const enhanced = await trajectoryPredictionService.enhanceAircraftWithPredictions(filteredAircraft);

      const predictedCount = enhanced.filter((a: any) => a.predicted).length;
      const routesCount = enhanced.filter((a: any) => a.route).length;
      const staleCount = enhanced.filter((a: any) => a.isStale).length;
      const filteredCount = enrichedWithRoutes.length - filteredAircraft.length;

      if (predictedCount > 0) {
        logger.debug(`Applied trajectory predictions to ${predictedCount}/${enhanced.length} aircraft`);
      }

      if (routesCount > 0) {
        logger.info(`Included route data for ${routesCount}/${enhanced.length} aircraft (from cache)`);
      }

      if (filteredCount > 0) {
        logger.info(`Filtered out ${filteredCount} old landed aircraft`);
      }

      if (staleCount > 0) {
        logger.warn(`Returning ${staleCount} stale aircraft (data may be outdated)`);
      }

      logger.info(`Returning ${enhanced.length} aircraft (${enhanced.length - staleCount} fresh, ${staleCount} stale)`);
      return enhanced;
    } catch (error) {
      const err = error as Error;
      logger.error('Error in getAircraftInBounds', {
        bounds: {
          latmin,
          lonmin,
          latmax,
          lonmax,
        },
        error: err.message,
      });
      throw error;
    }
  }

  private async enrichAircraftWithAerodatabox(aircraftList: any[]): Promise<void> {
    if (!aircraftList || aircraftList.length === 0) {
      return;
    }

    const maxLookups = 3;
    const candidates = aircraftList
      .filter((plane) => {
        if (!plane || !plane.icao24) {
          return false;
        }
        const missingCallsign = !plane.callsign || String(plane.callsign).trim() === '';
        const missingArrival =
          !plane.route?.arrivalAirport?.icao &&
          !plane.route?.arrivalAirport?.iata &&
          !plane.route?.arrivalAirport?.name;
        return missingCallsign || missingArrival;
      })
      .slice(0, maxLookups);

    for (const plane of candidates) {
      const icao24 = String(plane.icao24).toLowerCase();
      try {
        const aerodataboxData = await aerodataboxService.getFlightByIcao24(icao24);
        if (!aerodataboxData) {
          continue;
        }

        const { routeData, callsign, aircraftModel, registration } = aerodataboxData;

        if (callsign && (!plane.callsign || String(plane.callsign).trim() === '')) {
          plane.callsign = callsign;
          try {
            await postgresRepository.updateAircraftCallsign(icao24, callsign);
          } catch (err) {
            const error = err as Error;
            logger.debug('Failed to persist callsign from Aerodatabox (bounds enrichment)', {
              icao24,
              error: error.message,
            });
          }
        }

        const mappedRoute = {
          departureAirport: routeData.departureAirport,
          arrivalAirport: routeData.arrivalAirport,
          flightData: routeData.flightData,
          aircraft: routeData.aircraft
            ? {
                model: routeData.aircraft.model || null,
                type: routeData.aircraft.type || null,
                category: null,
              }
            : undefined,
          flightStatus: routeData.flightStatus || null,
          registration: routeData.registration || registration || null,
          source: routeData.source || 'aerodatabox',
          callsign: routeData.callsign || plane.callsign || null,
          icao24: routeData.icao24 || icao24,
        };

        const hasRouteDetails = mappedRoute.departureAirport || mappedRoute.arrivalAirport;

        if (!hasRouteDetails && !mappedRoute.callsign) {
          continue;
        }

        plane.route = {
          ...(plane.route || {}),
          ...mappedRoute,
        };
        plane.data_source = plane.data_source || 'aerodatabox';

        if (aircraftModel && !plane.aircraft_model) {
          plane.aircraft_model = aircraftModel;
        }
        if (registration && !plane.registration) {
          plane.registration = registration;
        }

        const cacheKey =
          mappedRoute.callsign && mappedRoute.callsign.trim() !== ''
            ? mappedRoute.callsign.trim()
            : mappedRoute.icao24 || icao24;

        if (cacheKey) {
          try {
            await flightRouteService.cacheRoute(cacheKey, mappedRoute as any);
          } catch (err) {
            const error = err as Error;
            logger.debug('Failed to cache Aerodatabox route during bounds enrichment', {
              cacheKey,
              error: error.message,
            });
          }
        }

        try {
          await postgresRepository.storeRouteHistory({ ...routeData, source: mappedRoute.source });
        } catch (err) {
          const error = err as Error;
          logger.debug('Failed to store Aerodatabox route history during bounds enrichment', {
            icao24,
            error: error.message,
          });
        }
      } catch (err) {
        const error = err as Error;
        logger.debug('Aerodatabox enrichment failed during bounds fetch', {
          icao24,
          error: error.message,
        });
      }
    }
  }

  /**
   * Initialize database tables
   */
  async initializeDatabase(): Promise<void> {
    try {
      await postgresRepository.createMainTable();
      await postgresRepository.createAircraftStatesIndexes(); // Performance indexes
      await postgresRepository.createHistoryTable();
      await postgresRepository.createHistoryTableIndexes(); // Performance indexes
      await postgresRepository.createFlightRoutesTable();
      await postgresRepository.createUsersTable();
      // Feeder service tables
      await postgresRepository.createFeedersTable();
      await postgresRepository.createFeederStatsTable();
      await postgresRepository.addFeederColumnsToAircraftStates();
      await postgresRepository.addFeederColumnsToAircraftStatesHistory();
      // Airport schema tables (airports, runways, frequencies, navaids)
      // Wrap in try-catch to allow server to start even if airport init fails
      try {
        await initializeAirportSchema(postgresRepository.getDb());
        logger.info('Airport schema initialized successfully');
      } catch (error) {
        const err = error as Error;
        logger.warn('Airport schema initialization failed (tables may already exist)', {
          error: err.message,
        });
        // Don't throw - allow server to continue
      }
      logger.info('Database initialized successfully with performance indexes');
    } catch (error) {
      const err = error as Error;
      logger.error('Error initializing database', { error: err.message });
      throw error;
    }
  }

  /**
   * Populate database with initial data
   */
  async populateInitialData(): Promise<void> {
    try {
      const boundingBoxes: BoundingBox[] = [
        {
          lamin: -90,
          lomin: -180,
          lamax: 0,
          lomax: 0,
        },
        {
          lamin: 0,
          lomin: -180,
          lamax: 90,
          lomax: 0,
        },
        {
          lamin: -90,
          lomin: 0,
          lamax: 0,
          lomax: 180,
        },
        {
          lamin: 0,
          lomin: 0,
          lamax: 90,
          lomax: 180,
        },
      ];

      const promises = boundingBoxes.map((box) => this.fetchAndUpdateAircraftInBounds(box));

      await Promise.all(promises);
      logger.info('Initial data population complete');
    } catch (error) {
      const err = error as Error;
      logger.error('Error populating initial data', { error: err.message });
      throw error;
    }
  }
}

// Export singleton instance
const aircraftService = new AircraftService();
export default aircraftService;
