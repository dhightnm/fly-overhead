import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

interface Waypoint {
  code: string;
  name: string | null;
  type: string | null;
  latitude: number;
  longitude: number;
  source: string;
  order: number;
}

interface RouteData {
  route?: string | null;
  callsign?: string | null;
  icao24?: string | null;
  departure_icao?: string | null;
  arrival_icao?: string | null;
  created_at?: Date;
  actual_flight_start?: Date | null;
  actual_flight_end?: Date | null;
}

interface FlightPlanRoute {
  icao24: string | null | undefined;
  callsign: string | null | undefined;
  routeString: string | null;
  departure: string | null | undefined;
  arrival: string | null | undefined;
  waypoints: Waypoint[];
  waypointCount: number;
  created_at: Date | undefined;
  available: boolean;
  routeSource: string | null;
  message?: string;
}

/**
 * Flight Plan Route Service
 *
 * Parses filed flight plan routes (stored as space-separated waypoint codes)
 * and converts them to coordinates using the navaids table.
 */
class FlightPlanRouteService {
  /**
   * Parse route string and extract waypoint identifiers
   */
  parseRouteString(routeString: string | null | undefined): string[] {
    if (!routeString || typeof routeString !== 'string') {
      return [];
    }

    const normalized = routeString.replace(/\./g, ' ');

    const waypoints = normalized
      .split(/\s+/)
      .map((wp) => wp.trim().toUpperCase())
      .filter((wp) => wp.length > 0);

    const excludePatterns = [
      /^DCT$/,
      /^VFR$/,
      /^IFR$/,
      /^\d+$/,
      /^FL\d+$/,
      /^A\d+$/,
      /^[NS]\d+[EW]$/,
    ];

    return waypoints.filter((wp) => !excludePatterns.some((pattern) => pattern.test(wp)));
  }

  /**
   * Look up waypoint coordinates from navaids table
   */
  async lookupWaypoint(waypointCode: string | null | undefined): Promise<Waypoint | null> {
    if (!waypointCode) return null;

    const code = waypointCode.toUpperCase().trim();

    const navaidQuery = `
      SELECT ident, name, type, latitude_deg, longitude_deg, geom
      FROM navaids
      WHERE UPPER(ident) = $1
        AND latitude_deg IS NOT NULL
        AND longitude_deg IS NOT NULL
      LIMIT 1
    `;

    try {
      const navaid = await postgresRepository.getDb().oneOrNone(navaidQuery, [code]);
      if (navaid) {
        const lat = parseFloat(navaid.latitude_deg);
        const lng = parseFloat(navaid.longitude_deg);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          logger.warn('Invalid coordinates for navaid', {
            code,
            lat,
            lng,
            original_lat: navaid.latitude_deg,
            original_lng: navaid.longitude_deg,
          });
          return null;
        }

        return {
          code: navaid.ident,
          name: navaid.name,
          type: navaid.type,
          latitude: lat,
          longitude: lng,
          source: 'navaid',
          order: 0,
        };
      }
    } catch (err) {
      const error = err as Error;
      logger.debug('Error looking up navaid', { waypointCode: code, error: error.message });
    }

    const airportQuery = `
      SELECT ident, name, type, latitude_deg, longitude_deg, geom
      FROM airports
      WHERE (
        UPPER(ident) = $1
        OR UPPER(iata_code) = $1
        OR UPPER(gps_code) = $1
      )
        AND latitude_deg IS NOT NULL
        AND longitude_deg IS NOT NULL
      LIMIT 1
    `;

    try {
      const airport = await postgresRepository.getDb().oneOrNone(airportQuery, [code]);
      if (airport) {
        const lat = parseFloat(airport.latitude_deg);
        const lng = parseFloat(airport.longitude_deg);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          logger.warn('Invalid coordinates for airport', {
            code,
            lat,
            lng,
            original_lat: airport.latitude_deg,
            original_lng: airport.longitude_deg,
          });
          return null;
        }

        return {
          code: airport.ident,
          name: airport.name,
          type: airport.type || 'airport',
          latitude: lat,
          longitude: lng,
          source: 'airport',
          order: 0,
        };
      }
    } catch (err) {
      const error = err as Error;
      logger.debug('Error looking up airport as waypoint', { waypointCode: code, error: error.message });
    }

    return null;
  }

  /**
   * Convert route string to array of waypoint coordinates
   */
  async parseRouteToWaypoints(routeString: string | null | undefined): Promise<Waypoint[]> {
    if (!routeString) {
      return [];
    }

    const waypointCodes = this.parseRouteString(routeString);

    if (waypointCodes.length === 0) {
      logger.debug('No waypoints parsed from route string', { routeString });
      return [];
    }

    logger.debug('Parsed waypoint codes from route', {
      routeString,
      waypointCount: waypointCodes.length,
      waypoints: waypointCodes.slice(0, 10),
    });

    const waypointLookups = await Promise.allSettled(
      waypointCodes.map((code) => this.lookupWaypoint(code)),
    );

    const waypoints: Waypoint[] = [];
    let foundCount = 0;
    let notFoundCount = 0;
    const notFoundCodes: string[] = [];

    for (let i = 0; i < waypointLookups.length; i++) {
      const result = waypointLookups[i];
      const code = waypointCodes[i];

      if (result.status === 'fulfilled' && result.value) {
        waypoints.push({
          ...result.value,
          order: i,
        });
        foundCount++;
      } else {
        notFoundCount++;
        notFoundCodes.push(code);
        logger.debug('Waypoint not found', { code });
      }
    }

    logger.info('Route waypoint lookup complete', {
      routeString,
      totalCodes: waypointCodes.length,
      found: foundCount,
      notFound: notFoundCount,
      successRate: `${((foundCount / waypointCodes.length) * 100).toFixed(1)}%`,
      parsedCodes: waypointCodes,
      foundCodes: waypoints.map((wp) => wp.code),
      notFoundCodes,
    });

    return waypoints.sort((a, b) => a.order - b.order);
  }

  /**
   * Create route waypoints from departure and arrival airports
   */
  async createRouteFromAirports(
    departureCode: string | null | undefined,
    arrivalCode: string | null | undefined,
  ): Promise<Waypoint[] | null> {
    if (!departureCode || !arrivalCode) {
      return null;
    }

    try {
      const depAirport = await postgresRepository.findAirportByCode(departureCode);
      const arrAirport = await postgresRepository.findAirportByCode(arrivalCode);

      if (!depAirport || !arrAirport) {
        logger.debug('Could not find airports for route', {
          departure: departureCode,
          arrival: arrivalCode,
        });
        return null;
      }

      const waypoints: Waypoint[] = [
        {
          code: depAirport.ident || depAirport.iata_code || departureCode,
          name: depAirport.name,
          type: 'airport',
          latitude: parseFloat(depAirport.latitude_deg),
          longitude: parseFloat(depAirport.longitude_deg),
          source: 'airport',
          order: 0,
        },
        {
          code: arrAirport.ident || arrAirport.iata_code || arrivalCode,
          name: arrAirport.name,
          type: 'airport',
          latitude: parseFloat(arrAirport.latitude_deg),
          longitude: parseFloat(arrAirport.longitude_deg),
          source: 'airport',
          order: 1,
        },
      ];

      logger.info('Created route from airports', {
        departure: departureCode,
        arrival: arrivalCode,
        waypointCount: waypoints.length,
      });

      return waypoints;
    } catch (error) {
      const err = error as Error;
      logger.error('Error creating route from airports', {
        departure: departureCode,
        arrival: arrivalCode,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Get flight plan route waypoints for an aircraft
   */
  async getFlightPlanRoute(
    icao24: string | null | undefined,
    callsign: string | null | undefined,
  ): Promise<FlightPlanRoute> {
    try {
      let routeData = await postgresRepository.getDb().oneOrNone<RouteData>(
        `SELECT route, callsign, icao24, 
                departure_icao, arrival_icao,
                created_at, actual_flight_start, actual_flight_end
         FROM flight_routes_history
         WHERE ($1::text IS NULL OR icao24 = $1)
           AND ($2::text IS NULL OR callsign = $2)
           AND route IS NOT NULL
           AND route != ''
         ORDER BY 
           CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
           CASE WHEN actual_flight_start > NOW() - INTERVAL '24 hours' THEN 0 ELSE 1 END ASC,
           actual_flight_start DESC NULLS LAST,
           created_at DESC
         LIMIT 1`,
        [icao24 || null, callsign || null],
      );

      let waypoints: Waypoint[] | null = null;
      let routeSource: string | null = null;

      if (routeData && routeData.route) {
        logger.debug('Attempting to parse route string', {
          icao24,
          callsign,
          route: routeData.route.substring(0, 100),
        });

        waypoints = await this.parseRouteToWaypoints(routeData.route);

        if (waypoints && waypoints.length > 0) {
          routeSource = 'route_string';
          logger.info('Found route from route string', {
            icao24,
            callsign,
            waypointCount: waypoints.length,
          });
        } else {
          logger.debug('Route string parsed but no waypoints resolved', {
            icao24,
            callsign,
          });
        }
      }

      if (!waypoints || waypoints.length === 0) {
        logger.debug('Trying previous flights for route', { icao24, callsign });

        const previousFlights = await postgresRepository.getDb().any<RouteData>(
          `SELECT route, callsign, icao24, 
                  departure_icao, arrival_icao,
                  created_at, actual_flight_start, actual_flight_end
           FROM flight_routes_history
           WHERE ($1::text IS NULL OR icao24 = $1)
             AND ($2::text IS NULL OR callsign = $2)
             AND route IS NOT NULL
             AND route != ''
           ORDER BY 
             CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
             CASE WHEN actual_flight_start > NOW() - INTERVAL '24 hours' THEN 0 ELSE 1 END ASC,
             actual_flight_start DESC NULLS LAST,
             created_at DESC
           LIMIT 5`,
          [icao24 || null, callsign || null],
        );

        for (const flight of previousFlights) {
          if (flight.route) {
            waypoints = await this.parseRouteToWaypoints(flight.route);
            if (waypoints && waypoints.length > 0) {
              routeSource = 'previous_flight';
              routeData = flight;
              logger.info('Found route from previous flight', {
                icao24,
                callsign,
                waypointCount: waypoints.length,
                flightDate: flight.created_at,
              });
              break;
            }
          }
        }
      }

      if (!waypoints || waypoints.length === 0) {
        if (!routeData) {
          routeData = await postgresRepository.getDb().oneOrNone<RouteData>(
            `SELECT departure_icao, arrival_icao, callsign, icao24, created_at, actual_flight_start, actual_flight_end
             FROM flight_routes_history
             WHERE ($1::text IS NULL OR icao24 = $1)
               AND ($2::text IS NULL OR callsign = $2)
             ORDER BY 
               CASE WHEN actual_flight_end IS NULL THEN 0 ELSE 1 END ASC,
               CASE WHEN actual_flight_start > NOW() - INTERVAL '24 hours' THEN 0 ELSE 1 END ASC,
               actual_flight_start DESC NULLS LAST,
               created_at DESC
             LIMIT 1`,
            [icao24 || null, callsign || null],
          );
        }

        if (routeData && routeData.departure_icao && routeData.arrival_icao) {
          logger.debug('Creating route from airports', {
            icao24,
            callsign,
            departure: routeData.departure_icao,
            arrival: routeData.arrival_icao,
          });

          waypoints = await this.createRouteFromAirports(
            routeData.departure_icao,
            routeData.arrival_icao,
          );

          if (waypoints && waypoints.length > 0) {
            routeSource = 'airports_only';
            logger.info('Created route from airports', {
              icao24,
              callsign,
              waypointCount: waypoints.length,
            });
          }
        }
      }

      if (!waypoints || waypoints.length === 0) {
        logger.debug('No route available after all fallbacks', {
          icao24,
          callsign,
        });
        return {
          icao24: icao24 || routeData?.icao24,
          callsign: callsign || routeData?.callsign,
          available: false,
          waypoints: [],
          waypointCount: 0,
          created_at: routeData?.created_at,
          routeSource: null,
          routeString: null,
          departure: routeData?.departure_icao || null,
          arrival: routeData?.arrival_icao || null,
          message: 'Flight route not available for this flight',
        };
      }

      let finalWaypoints = [...waypoints];

      if (routeData && routeData.departure_icao && routeData.arrival_icao) {
        const firstWaypoint = finalWaypoints[0];
        const departureMatches = firstWaypoint && (
          firstWaypoint.code === routeData.departure_icao
          || firstWaypoint.code === routeData.departure_icao.replace(/^K/, '')
          || firstWaypoint.name?.toLowerCase().includes(routeData.departure_icao.toLowerCase())
        );

        if (!departureMatches) {
          try {
            const depAirport = await postgresRepository.findAirportByCode(routeData.departure_icao);
            if (depAirport && depAirport.latitude_deg && depAirport.longitude_deg) {
              finalWaypoints.unshift({
                code: depAirport.ident || routeData.departure_icao,
                name: depAirport.name,
                type: 'airport',
                latitude: parseFloat(depAirport.latitude_deg),
                longitude: parseFloat(depAirport.longitude_deg),
                source: 'airport',
                order: -1,
              });
            }
          } catch (err) {
            const error = err as Error;
            logger.debug('Could not add departure airport to waypoints', {
              departure: routeData.departure_icao,
              error: error.message,
            });
          }
        }

        const lastWaypoint = finalWaypoints[finalWaypoints.length - 1];
        const arrivalMatches = lastWaypoint && (
          lastWaypoint.code === routeData.arrival_icao
          || lastWaypoint.code === routeData.arrival_icao.replace(/^K/, '')
          || lastWaypoint.name?.toLowerCase().includes(routeData.arrival_icao.toLowerCase())
        );

        if (!arrivalMatches) {
          try {
            const arrAirport = await postgresRepository.findAirportByCode(routeData.arrival_icao);
            if (arrAirport && arrAirport.latitude_deg && arrAirport.longitude_deg) {
              finalWaypoints.push({
                code: arrAirport.ident || routeData.arrival_icao,
                name: arrAirport.name,
                type: 'airport',
                latitude: parseFloat(arrAirport.latitude_deg),
                longitude: parseFloat(arrAirport.longitude_deg),
                source: 'airport',
                order: finalWaypoints.length,
              });
            }
          } catch (err) {
            const error = err as Error;
            logger.debug('Could not add arrival airport to waypoints', {
              arrival: routeData.arrival_icao,
              error: error.message,
            });
          }
        }
      }

      finalWaypoints = finalWaypoints.map((wp, idx) => ({ ...wp, order: idx }));

      return {
        icao24: routeData?.icao24 || icao24,
        callsign: routeData?.callsign || callsign,
        routeString: routeData?.route || null,
        departure: routeData?.departure_icao || null,
        arrival: routeData?.arrival_icao || null,
        waypoints: finalWaypoints,
        waypointCount: finalWaypoints.length,
        created_at: routeData?.created_at,
        available: true,
        routeSource,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Error getting flight plan route', {
        icao24,
        callsign,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Test function: Check route data availability and sample routes
   */
  async testRouteDataAvailability(): Promise<any> {
    try {
      const stats = await postgresRepository.getDb().one(
        `SELECT 
          COUNT(*) as total_flights_with_routes,
          COUNT(DISTINCT icao24) as unique_aircraft,
          COUNT(DISTINCT callsign) as unique_callsigns
        FROM flight_routes_history
        WHERE route IS NOT NULL
          AND route != ''
          AND created_at > NOW() - INTERVAL '7 days'`,
      );

      const samples = await postgresRepository.getDb().any(
        `SELECT route, callsign, icao24, departure_icao, arrival_icao
         FROM flight_routes_history
         WHERE route IS NOT NULL
           AND route != ''
           AND created_at > NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC
         LIMIT 20`,
      );

      const testResults: any[] = [];
      for (const sample of (samples as any[]).slice(0, 5)) {
        const waypointCodes = this.parseRouteString(sample.route);
        const waypointCount = await Promise.all(
          waypointCodes.slice(0, 10).map((code) => this.lookupWaypoint(code)),
        );
        const foundCount = waypointCount.filter((wp) => wp !== null).length;

        testResults.push({
          callsign: sample.callsign,
          route: sample.route,
          parsedCodes: waypointCodes.slice(0, 10),
          lookupSuccess: `${foundCount}/${Math.min(waypointCodes.length, 10)}`,
        });
      }

      return {
        statistics: {
          totalFlightsWithRoutes: parseInt(stats.total_flights_with_routes, 10),
          uniqueAircraft: parseInt(stats.unique_aircraft, 10),
          uniqueCallsigns: parseInt(stats.unique_callsigns, 10),
        },
        samples: (samples as any[]).slice(0, 10).map((s: any) => ({
          callsign: s.callsign,
          icao24: s.icao24,
          route: s.route,
          departure: s.departure_icao,
          arrival: s.arrival_icao,
        })),
        testParsing: testResults,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Error testing route data availability', { error: err.message });
      throw error;
    }
  }
}

export default new FlightPlanRouteService();
