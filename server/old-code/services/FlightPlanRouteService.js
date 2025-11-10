const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');

/**
 * Flight Plan Route Service
 * 
 * Parses filed flight plan routes (stored as space-separated waypoint codes)
 * and converts them to coordinates using the navaids table.
 * 
 * Route format examples:
 * - "JFK VOR1 LAX" (simple)
 * - "KJFK.VOR1.KLAX" (SID/STAR format)
 * - "JFK5 VOR1 LAX1" (with runway transitions)
 */
class FlightPlanRouteService {
  /**
   * Parse route string and extract waypoint identifiers
   * Handles various formats:
   * - Space-separated: "JFK VOR1 LAX"
   * - Dot-separated (SID/STAR): "KJFK.VOR1.KLAX"
   * - Mixed: "JFK5.VOR1 LAX1"
   */
  parseRouteString(routeString) {
    if (!routeString || typeof routeString !== 'string') {
      return [];
    }

    // Replace dots with spaces, then split
    const normalized = routeString.replace(/\./g, ' ');
    
    // Split by spaces and filter out empty strings
    const waypoints = normalized
      .split(/\s+/)
      .map(wp => wp.trim().toUpperCase())
      .filter(wp => wp.length > 0);

    // Filter out common non-waypoint codes
    // These are often present in route strings but aren't navaids
    const excludePatterns = [
      /^DCT$/,           // Direct
      /^VFR$/,           // Visual flight rules
      /^IFR$/,           // Instrument flight rules
      /^\d+$/,           // Pure numbers (usually altitudes)
      /^FL\d+$/,         // Flight level
      /^A\d+$/,          // Airway designators (we might want these later, but skip for now)
      /^[NS]\d+[EW]$/,   // Coordinate-style (e.g., N40W70) - not navaids
    ];

    return waypoints.filter(wp => {
      return !excludePatterns.some(pattern => pattern.test(wp));
    });
  }

  /**
   * Look up waypoint coordinates from navaids table
   * Tries multiple matching strategies:
   * 1. Exact match on ident
   * 2. Match with airport codes (if waypoint is an airport identifier)
   */
  async lookupWaypoint(waypointCode) {
    if (!waypointCode) return null;

    const code = waypointCode.toUpperCase().trim();

    // First try navaids table
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
      
      // Validate coordinates are within valid ranges
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
      };
      }
    } catch (err) {
      logger.debug('Error looking up navaid', { waypointCode: code, error: err.message });
    }

    // If not found in navaids, try airports table (some waypoints are airports)
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
      
      // Validate coordinates are within valid ranges
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
      };
      }
    } catch (err) {
      logger.debug('Error looking up airport as waypoint', { waypointCode: code, error: err.message });
    }

    return null;
  }

  /**
   * Convert route string to array of waypoint coordinates
   * Returns array of {code, name, latitude, longitude, type} or null if not found
   */
  async parseRouteToWaypoints(routeString) {
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
      waypoints: waypointCodes.slice(0, 10), // Log first 10
    });

    // Look up each waypoint in parallel
    const waypointLookups = await Promise.allSettled(
      waypointCodes.map(code => this.lookupWaypoint(code))
    );

    const waypoints = [];
    let foundCount = 0;
    let notFoundCount = 0;
    const notFoundCodes = [];

    for (let i = 0; i < waypointLookups.length; i++) {
      const result = waypointLookups[i];
      const code = waypointCodes[i];

      if (result.status === 'fulfilled' && result.value) {
        waypoints.push({
          ...result.value,
          order: i, // Preserve order
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
      foundCodes: waypoints.map(wp => wp.code),
      notFoundCodes,
    });

    // Sort by order to preserve route sequence
    return waypoints.sort((a, b) => a.order - b.order);
  }

  /**
   * Create route waypoints from departure and arrival airports
   * Fallback when no route string is available
   */
  async createRouteFromAirports(departureCode, arrivalCode) {
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

      const waypoints = [
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
      logger.error('Error creating route from airports', {
        departure: departureCode,
        arrival: arrivalCode,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get flight plan route waypoints for an aircraft
   * Uses fallback strategy:
   * 1. Try current/most recent flight route
   * 2. Try previous flights (up to 5)
   * 3. Try creating route from departure/arrival airports
   * 4. Return null if all fail
   */
  async getFlightPlanRoute(icao24, callsign) {
    try {
      // Step 1: Try most recent route with route string
      // Priority order:
      // 1. Active flights (flight_end IS NULL) - most recent first
      // 2. Recent completed flights (within last 24 hours)
      // 3. Older flights by actual_flight_start DESC
      let routeData = await postgresRepository.getDb().oneOrNone(
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
        [icao24 || null, callsign || null]
      );

      let waypoints = null;
      let routeSource = null;

      // If route string found, parse it
      if (routeData && routeData.route) {
        logger.debug('Attempting to parse route string', {
          icao24,
          callsign,
          route: routeData.route.substring(0, 100), // Log first 100 chars
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

      // Step 2: If no waypoints from route string, try previous flights
      if (!waypoints || waypoints.length === 0) {
        logger.debug('Trying previous flights for route', { icao24, callsign });
        
        const previousFlightsQuery = `
          SELECT route, callsign, icao24, 
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
          LIMIT 5
        `;

        const previousFlights = await postgresRepository.getDb().any(
          previousFlightsQuery,
          [icao24 || null, callsign || null]
        );

        // Try each previous flight until we find one with waypoints
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

      // Step 3: If still no waypoints, try creating route from airports
      if (!waypoints || waypoints.length === 0) {
        // Get departure/arrival from most recent flight (even without route string)
        if (!routeData) {
          routeData = await postgresRepository.getDb().oneOrNone(
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
            [icao24 || null, callsign || null]
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
            routeData.arrival_icao
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

      // Step 4: If all fallbacks failed, return null
      if (!waypoints || waypoints.length === 0) {
        logger.debug('No route available after all fallbacks', {
          icao24,
          callsign,
        });
        return {
          icao24: icao24 || routeData?.icao24,
          callsign: callsign || routeData?.callsign,
          available: false,
          waypoints: null,
          routeSource: null,
          message: 'Flight route not available for this flight',
        };
      }

      // Add departure and arrival airports to waypoints if they're not already included
      let finalWaypoints = [...waypoints];
      
      if (routeData.departure_icao && routeData.arrival_icao) {
        // Check if departure airport is already first waypoint
        const firstWaypoint = finalWaypoints[0];
        const departureMatches = firstWaypoint && (
          firstWaypoint.code === routeData.departure_icao ||
          firstWaypoint.code === routeData.departure_icao.replace(/^K/, '') ||
          firstWaypoint.name?.toLowerCase().includes(routeData.departure_icao.toLowerCase())
        );
        
        if (!departureMatches) {
          // Try to get departure airport coordinates
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
                order: -1, // Before first waypoint
              });
            }
          } catch (err) {
            logger.debug('Could not add departure airport to waypoints', {
              departure: routeData.departure_icao,
              error: err.message,
            });
          }
        }
        
        // Check if arrival airport is already last waypoint
        const lastWaypoint = finalWaypoints[finalWaypoints.length - 1];
        const arrivalMatches = lastWaypoint && (
          lastWaypoint.code === routeData.arrival_icao ||
          lastWaypoint.code === routeData.arrival_icao.replace(/^K/, '') ||
          lastWaypoint.name?.toLowerCase().includes(routeData.arrival_icao.toLowerCase())
        );
        
        if (!arrivalMatches) {
          // Try to get arrival airport coordinates
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
            logger.debug('Could not add arrival airport to waypoints', {
              arrival: routeData.arrival_icao,
              error: err.message,
            });
          }
        }
      }
      
      // Re-number order for display
      finalWaypoints = finalWaypoints.map((wp, idx) => ({ ...wp, order: idx }));

      // Return successful route
      return {
        icao24: routeData.icao24 || icao24,
        callsign: routeData.callsign || callsign,
        routeString: routeData.route || null,
        departure: routeData.departure_icao,
        arrival: routeData.arrival_icao,
        waypoints: finalWaypoints,
        waypointCount: finalWaypoints.length,
        created_at: routeData.created_at,
        available: true,
        routeSource, // 'route_string', 'previous_flight', or 'airports_only'
      };
    } catch (error) {
      logger.error('Error getting flight plan route', {
        icao24,
        callsign,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Test function: Check route data availability and sample routes
   * Returns statistics about route data in database
   */
  async testRouteDataAvailability() {
    try {
      // Count flights with routes
      const routeCountQuery = `
        SELECT 
          COUNT(*) as total_flights_with_routes,
          COUNT(DISTINCT icao24) as unique_aircraft,
          COUNT(DISTINCT callsign) as unique_callsigns
        FROM flight_routes_history
        WHERE route IS NOT NULL
          AND route != ''
          AND created_at > NOW() - INTERVAL '7 days'
      `;

      const stats = await postgresRepository.getDb().one(routeCountQuery);

      // Sample some routes to see format
      const sampleQuery = `
        SELECT route, callsign, icao24, departure_icao, arrival_icao
        FROM flight_routes_history
        WHERE route IS NOT NULL
          AND route != ''
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 20
      `;

      const samples = await postgresRepository.getDb().any(sampleQuery);

      // Test parsing a few sample routes
      const testResults = [];
      for (const sample of samples.slice(0, 5)) {
        const waypointCodes = this.parseRouteString(sample.route);
        const waypointCount = await Promise.all(
          waypointCodes.slice(0, 10).map(code => this.lookupWaypoint(code))
        );
        const foundCount = waypointCount.filter(wp => wp !== null).length;

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
        samples: samples.slice(0, 10).map(s => ({
          callsign: s.callsign,
          icao24: s.icao24,
          route: s.route,
          departure: s.departure_icao,
          arrival: s.arrival_icao,
        })),
        testParsing: testResults,
      };
    } catch (error) {
      logger.error('Error testing route data availability', { error: error.message });
      throw error;
    }
  }
}

module.exports = new FlightPlanRouteService();

