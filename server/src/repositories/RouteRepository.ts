import pgPromise from 'pg-promise';
import crypto from 'crypto';
import logger from '../utils/logger';
import type { RouteData } from '../types/api.types';
import type { FlightRouteHistory } from '../types/database.types';

/**
 * Repository for route caching and flight history
 */
class RouteRepository {
  private db: pgPromise.IDatabase<any>;

  constructor(db: pgPromise.IDatabase<any>) {
    this.db = db;
  }

  async cacheRoute(cacheKey: string, routeData: RouteData): Promise<void> {
    try {
      // Log source for debugging
      logger.debug('Caching route with source', {
        cacheKey,
        callsign: routeData.callsign,
        source: routeData.source,
        hasSource: !!routeData.source,
        routeDataKeys: Object.keys(routeData),
      });

      const query = `
        INSERT INTO flight_routes_cache (
          cache_key, callsign, icao24,
          departure_iata, departure_icao, departure_name,
          arrival_iata, arrival_icao, arrival_name,
          source, aircraft_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (cache_key) DO UPDATE SET
          last_used = CURRENT_TIMESTAMP,
          departure_iata = EXCLUDED.departure_iata,
          departure_icao = EXCLUDED.departure_icao,
          departure_name = EXCLUDED.departure_name,
          arrival_iata = EXCLUDED.arrival_iata,
          arrival_icao = EXCLUDED.arrival_icao,
          arrival_name = EXCLUDED.arrival_name,
          source = EXCLUDED.source,
          aircraft_type = EXCLUDED.aircraft_type;
      `;

      const sourceValue = routeData.source || null;
      // Prefer model over type - "A321" is more useful than "Plane"
      const aircraftType = routeData.aircraft?.model
        || routeData.aircraft?.type
        || routeData.aircraft_type
        || null;

      logger.debug('About to insert route with source value', {
        cacheKey,
        sourceValue,
        sourceType: typeof sourceValue,
        aircraftType,
        hasModel: !!routeData.aircraft?.model,
        hasType: !!routeData.aircraft?.type,
      });

      await this.db.query(query, [
        cacheKey,
        routeData.callsign || null,
        routeData.icao24 || null,
        routeData.departureAirport?.iata || null,
        routeData.departureAirport?.icao || null,
        routeData.departureAirport?.name || null,
        routeData.arrivalAirport?.iata || null,
        routeData.arrivalAirport?.icao || null,
        routeData.arrivalAirport?.name || null,
        sourceValue,
        aircraftType,
      ]);

      logger.debug('Route cached successfully', { cacheKey, source: sourceValue });
    } catch (error) {
      const err = error as Error;
      logger.error('Error caching route', {
        cacheKey,
        callsign: routeData.callsign,
        error: err.message,
        stack: err.stack,
      });
      throw error;
    }
  }

  async getCachedRoute(cacheKey: string): Promise<RouteData | null> {
    // Different TTLs based on route completeness:
    // - Complete routes (has arrival): 24 hours
    // - Incomplete routes (no arrival, inference): 30 minutes
    // This allows re-fetching when in-flight aircraft land
    const query = `
      SELECT
        callsign,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source, aircraft_type,
        created_at
      FROM flight_routes_cache
      WHERE cache_key = $1
        AND (
          -- Complete routes: 24h cache
          (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL)
          AND created_at > NOW() - INTERVAL '24 hours'
          OR
          -- Incomplete inferred routes: 30min cache
          (arrival_icao IS NULL AND arrival_iata IS NULL AND source = 'inference')
          AND created_at > NOW() - INTERVAL '30 minutes'
          OR
          -- Incomplete non-inference routes: 2h cache (APIs might have data later)
          (arrival_icao IS NULL AND arrival_iata IS NULL AND source != 'inference')
          AND created_at > NOW() - INTERVAL '2 hours'
        )
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [cacheKey]);

    if (!result) return null;

    return {
      departureAirport: {
        iata: result.departure_iata,
        icao: result.departure_icao,
        name: result.departure_name,
      },
      arrivalAirport: {
        iata: result.arrival_iata,
        icao: result.arrival_icao,
        name: result.arrival_name,
      },
      source: result.source,
      aircraft: result.aircraft_type ? {
        type: result.aircraft_type,
      } : undefined,
    };
  }

  async findHistoricalRoute(callsign: string, departureIcao: string): Promise<any> {
    const query = `
      SELECT
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        created_at
      FROM flight_routes_history
      WHERE UPPER(TRIM(callsign)) = UPPER($1)
        AND (UPPER(departure_icao) = UPPER($2) OR UPPER(departure_iata) = UPPER($2))
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [callsign, departureIcao]);

    if (!result) return null;

    return {
      departure_iata: result.departure_iata,
      departure_icao: result.departure_icao,
      departure_name: result.departure_name,
      arrival_iata: result.arrival_iata,
      arrival_icao: result.arrival_icao,
      arrival_name: result.arrival_name,
      source: result.source,
      created_at: result.created_at,
    };
  }

  async findHistoricalRouteByIcao24(icao24: string, departureIcao: string): Promise<any> {
    const query = `
      SELECT
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        created_at
      FROM flight_routes_history
      WHERE LOWER(TRIM(icao24)) = LOWER($1)
        AND (UPPER(departure_icao) = UPPER($2) OR UPPER(departure_iata) = UPPER($2))
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [icao24, departureIcao]);

    if (!result) return null;

    return {
      departure_iata: result.departure_iata,
      departure_icao: result.departure_icao,
      departure_name: result.departure_name,
      arrival_iata: result.arrival_iata,
      arrival_icao: result.arrival_icao,
      arrival_name: result.arrival_name,
      source: result.source,
      created_at: result.created_at,
    };
  }

  async storeRouteHistory(routeData: RouteData): Promise<void> {
    // First, check if this is a recent flight that might need updating
    const callsignNorm = routeData.callsign ? String(routeData.callsign).trim().toUpperCase() : '';
    const icao24Norm = routeData.icao24 ? String(routeData.icao24).trim().toLowerCase() : '';

    const scheduledStart = routeData.flightData?.scheduledDeparture
      ? new Date(routeData.flightData.scheduledDeparture * 1000)
      : null;
    const scheduledEnd = routeData.flightData?.scheduledArrival
      ? new Date(routeData.flightData.scheduledArrival * 1000)
      : null;
    const actualStart = routeData.flightData?.actualDeparture
      ? new Date(routeData.flightData.actualDeparture * 1000)
      : null;
    const actualEnd = routeData.flightData?.actualArrival
      ? new Date(routeData.flightData.actualArrival * 1000)
      : null;

    // Check for existing recent flight with same departure time (within 48 hours)
    const departureTime = actualStart || scheduledStart;
    let existingFlightId: number | null = null;

    if (icao24Norm && callsignNorm && departureTime) {
      const recentFlightQuery = `
        SELECT id, actual_flight_end, flight_status, actual_flight_start, scheduled_flight_start
        FROM flight_routes_history
        WHERE icao24 = $1
          AND callsign = $2
          AND (
            ($3 IS NOT NULL AND actual_flight_start IS NOT NULL
             AND ABS(EXTRACT(EPOCH FROM (actual_flight_start - $3::timestamp))) < 300)
            OR ($4 IS NOT NULL AND scheduled_flight_start IS NOT NULL AND actual_flight_start IS NULL
             AND ABS(EXTRACT(EPOCH FROM (scheduled_flight_start - $4::timestamp))) < 300)
          )
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const existingFlight = await this.db.oneOrNone(recentFlightQuery, [
        icao24Norm,
        callsignNorm,
        actualStart,
        scheduledStart,
      ]);

      if (existingFlight) {
        existingFlightId = existingFlight.id;

        const isSameFlight = !actualEnd || !existingFlight.actual_flight_end
          || Math.abs((actualEnd.getTime() - existingFlight.actual_flight_end.getTime()) / 1000) < 300;

        const hasMoreCompleteData = actualEnd && !existingFlight.actual_flight_end;
        const statusChanged = existingFlight.flight_status !== routeData.flightStatus && routeData.flightStatus;
        const needsFlightKeyFix = (!existingFlight.flight_key || existingFlight.flight_key.includes('||'))
          && departureTime && (actualEnd || scheduledEnd);
        const needsUpdate = (isSameFlight && (hasMoreCompleteData || statusChanged || needsFlightKeyFix))
          || (needsFlightKeyFix && departureTime);

        if (needsUpdate && existingFlightId) {
          logger.info('Updating existing recent flight with completed data', {
            flightId: existingFlightId,
            callsign: callsignNorm,
            icao24: icao24Norm,
            oldStatus: existingFlight.flight_status,
            newStatus: routeData.flightStatus,
            hasNewArrival: !!actualEnd,
            hadArrival: !!existingFlight.actual_flight_end,
          });

          const updateFields: Record<string, any> = {};
          if (needsFlightKeyFix) {
            const startKey = departureTime ? departureTime.toISOString() : 'null';
            const endKey = (actualEnd || scheduledEnd) ? (actualEnd || scheduledEnd).toISOString() : 'null';
            const flightKeyComponents = [
              icao24Norm,
              callsignNorm,
              startKey,
              endKey,
            ].join('|');
            updateFields.flight_key = crypto.createHash('md5').update(flightKeyComponents).digest('hex');
          }
          if (actualEnd) updateFields.actual_flight_end = actualEnd;
          if (actualStart && !existingFlight.actual_flight_start) updateFields.actual_flight_start = actualStart;
          if (scheduledEnd) updateFields.scheduled_flight_end = scheduledEnd;
          if (scheduledStart && !existingFlight.scheduled_flight_start) {
            updateFields.scheduled_flight_start = scheduledStart;
          }
          if (routeData.flightStatus) updateFields.flight_status = routeData.flightStatus;
          if (routeData.registration) updateFields.registration = routeData.registration;
          if (routeData.route) updateFields.route = routeData.route;
          if (routeData.routeDistance !== undefined) updateFields.route_distance = routeData.routeDistance;
          if (routeData.baggageClaim) updateFields.baggage_claim = routeData.baggageClaim;
          if (routeData.gateOrigin) updateFields.gate_origin = routeData.gateOrigin;
          if (routeData.gateDestination) updateFields.gate_destination = routeData.gateDestination;
          if (routeData.terminalOrigin) updateFields.terminal_origin = routeData.terminalOrigin;
          if (routeData.terminalDestination) updateFields.terminal_destination = routeData.terminalDestination;
          if (routeData.actualRunwayOff) updateFields.actual_runway_off = routeData.actualRunwayOff;
          if (routeData.actualRunwayOn) updateFields.actual_runway_on = routeData.actualRunwayOn;
          if (routeData.progressPercent !== undefined) updateFields.progress_percent = routeData.progressPercent;
          if (routeData.filedAirspeed !== undefined) updateFields.filed_airspeed = routeData.filedAirspeed;
          if (routeData.blocked !== undefined) updateFields.blocked = routeData.blocked;
          if (routeData.diverted !== undefined) updateFields.diverted = routeData.diverted;
          if (routeData.cancelled !== undefined) updateFields.cancelled = routeData.cancelled;
          if (routeData.departureDelay !== undefined) updateFields.departure_delay = routeData.departureDelay;
          if (routeData.arrivalDelay !== undefined) updateFields.arrival_delay = routeData.arrivalDelay;
          if (actualStart && actualEnd) {
            updateFields.actual_ete = Math.max(0, Math.floor((actualEnd.getTime() - actualStart.getTime()) / 1000));
          }

          await this.updateFlightHistoryById(existingFlightId, updateFields);
          return;
        }
      }
    }

    // Build deterministic keys for new flights
    const startKey = departureTime ? departureTime.toISOString() : '';
    const endKey = (actualEnd || scheduledEnd) ? (actualEnd || scheduledEnd).toISOString() : '';
    const depIcao = routeData.departureAirport?.icao ? String(routeData.departureAirport.icao).trim().toUpperCase() : '';
    const arrIcao = routeData.arrivalAirport?.icao ? String(routeData.arrivalAirport.icao).trim().toUpperCase() : '';

    const flightKeyComponents = [
      icao24Norm,
      callsignNorm,
      startKey || 'null',
      endKey || 'null',
    ].join('|');
    const flightKey = crypto.createHash('md5').update(flightKeyComponents).digest('hex');
    const routeKey = [depIcao, arrIcao].join('>');

    // Calculate ETE if available (reserved for future use)
    // Note: Currently not used in query, but calculated for potential future use
    let eteSeconds: number | null = null;
    if (typeof routeData.flightData?.duration === 'number') {
      eteSeconds = routeData.flightData.duration;
    } else if (typeof routeData.flightData?.filedEte === 'number') {
      eteSeconds = routeData.flightData.filedEte;
    }
    // Suppress unused variable warning - reserved for future use
    if (eteSeconds !== null) {
      // Reserved for future use - eteSeconds will be used in future queries
    }

    const scheduledEte = (scheduledStart && scheduledEnd)
      ? Math.max(0, Math.floor((scheduledEnd.getTime() - scheduledStart.getTime()) / 1000))
      : null;
    const actualEte = (actualStart && actualEnd)
      ? Math.max(0, Math.floor((actualEnd.getTime() - actualStart.getTime()) / 1000))
      : null;

    const query = `
      INSERT INTO flight_routes_history (
        callsign, icao24,
        flight_key, route_key,
        aircraft_type, aircraft_model,
        departure_iata, departure_icao, departure_name,
        arrival_iata, arrival_icao, arrival_name,
        source,
        first_seen, last_seen,
        scheduled_flight_start, scheduled_flight_end,
        actual_flight_start, actual_flight_end,
        scheduled_ete, actual_ete,
        registration, flight_status, route, route_distance,
        baggage_claim, gate_origin, gate_destination,
        terminal_origin, terminal_destination,
        actual_runway_off, actual_runway_on,
        progress_percent, filed_airspeed,
        blocked, diverted, cancelled,
        departure_delay, arrival_delay
      )
      VALUES (
        $1, $2,
        $3, $4,
        $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13,
        $14, $15,
        $16, $17,
        $18, $19,
        $20, $21,
        $22, $23, $24, $25,
        $26, $27, $28,
        $29, $30,
        $31, $32,
        $33, $34,
        $35, $36, $37,
        $38, $39
      )
      ON CONFLICT ON CONSTRAINT uniq_flight_routes_history_flight_key DO NOTHING;
    `;

    try {
      await this.db.query(query, [
        routeData.callsign || null,
        routeData.icao24 || null,
        flightKey || null,
        routeKey || null,
        routeData.aircraft?.type || routeData.aircraft_type || null,
        routeData.aircraft?.model || routeData.aircraft_model || null,
        routeData.departureAirport?.iata || null,
        routeData.departureAirport?.icao || null,
        routeData.departureAirport?.name || null,
        routeData.arrivalAirport?.iata || null,
        routeData.arrivalAirport?.icao || null,
        routeData.arrivalAirport?.name || null,
        routeData.source || null,
        routeData.flightData?.firstSeen || null,
        routeData.flightData?.lastSeen || null,
        scheduledStart,
        scheduledEnd,
        actualStart,
        actualEnd,
        scheduledEte,
        actualEte,
        routeData.registration || null,
        routeData.flightStatus || null,
        routeData.route || null,
        routeData.routeDistance || null,
        routeData.baggageClaim || null,
        routeData.gateOrigin || null,
        routeData.gateDestination || null,
        routeData.terminalOrigin || null,
        routeData.terminalDestination || null,
        routeData.actualRunwayOff || null,
        routeData.actualRunwayOn || null,
        routeData.progressPercent || null,
        routeData.filedAirspeed || null,
        routeData.blocked || false,
        routeData.diverted || false,
        routeData.cancelled || false,
        routeData.departureDelay || null,
        routeData.arrivalDelay || null,
      ]);
    } catch (error) {
      const err = error as Error;
      // Ignore duplicate key errors (expected when same flight already stored)
      if (err.message?.includes('duplicate key') || err.message?.includes('uniq_flight_routes_history_flight_key')) {
        logger.debug('Flight already exists in history (duplicate key)', {
          callsign: callsignNorm,
          icao24: icao24Norm,
          flightKey,
        });
        return;
      }
      throw error;
    }
  }

  async findFlightsNeedingBackfill(limit: number = 20): Promise<FlightRouteHistory[]> {
    const query = `
      SELECT id, icao24, callsign, created_at,
             actual_flight_start, actual_flight_end,
             scheduled_flight_start, scheduled_flight_end,
             first_seen, last_seen,
             aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE created_at < NOW() - INTERVAL '24 hours'
        AND (
          (actual_flight_start IS NULL AND first_seen IS NULL AND scheduled_flight_start IS NULL)
          OR (actual_flight_end IS NULL AND last_seen IS NULL AND scheduled_flight_end IS NULL)
          OR aircraft_type IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    return this.db.any<FlightRouteHistory>(query, [limit]);
  }

  async findFlightsNeedingBackfillInRange(
    startDate: string,
    endDate: string,
    limit: number = 50,
  ): Promise<FlightRouteHistory[]> {
    const query = `
      SELECT id, icao24, callsign, created_at,
             actual_flight_start, actual_flight_end,
             scheduled_flight_start, scheduled_flight_end,
             first_seen, last_seen,
             aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE created_at >= $1::date
        AND created_at < ($2::date + INTERVAL '1 day')
        AND (
          (actual_flight_start IS NULL AND first_seen IS NULL AND scheduled_flight_start IS NULL)
          OR (actual_flight_end IS NULL AND last_seen IS NULL AND scheduled_flight_end IS NULL)
          OR aircraft_type IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $3;
    `;
    return this.db.any<FlightRouteHistory>(query, [startDate, endDate, limit]);
  }

  async findFlightsMissingAllRecent(limit: number = 50): Promise<FlightRouteHistory[]> {
    const query = `
      SELECT id, icao24, callsign, created_at
      FROM flight_routes_history
      WHERE created_at >= NOW() - INTERVAL '5 days'
        AND (
          actual_flight_start IS NULL
          AND actual_flight_end IS NULL
          AND scheduled_flight_start IS NULL
          AND scheduled_flight_end IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $1;
    `;
    return this.db.any<FlightRouteHistory>(query, [limit]);
  }

  async updateFlightHistoryById(id: number, fields: Partial<FlightRouteHistory>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    const push = (col: string, val: any) => {
      sets.push(`${col} = $${idx}`);
      values.push(val);
      idx += 1;
    };

    if (fields.flight_key !== undefined) push('flight_key', fields.flight_key);
    if (fields.first_seen !== undefined) push('first_seen', fields.first_seen);
    if (fields.last_seen !== undefined) push('last_seen', fields.last_seen);
    if (fields.scheduled_flight_start !== undefined) push('scheduled_flight_start', fields.scheduled_flight_start);
    if (fields.scheduled_flight_end !== undefined) push('scheduled_flight_end', fields.scheduled_flight_end);
    if (fields.actual_flight_start !== undefined) push('actual_flight_start', fields.actual_flight_start);
    if (fields.actual_flight_end !== undefined) push('actual_flight_end', fields.actual_flight_end);
    if (fields.scheduled_ete !== undefined) push('scheduled_ete', fields.scheduled_ete);
    if (fields.actual_ete !== undefined) push('actual_ete', fields.actual_ete);
    if (fields.aircraft_type !== undefined) push('aircraft_type', fields.aircraft_type);
    if (fields.aircraft_model !== undefined) push('aircraft_model', fields.aircraft_model);
    if (fields.registration !== undefined) push('registration', fields.registration);
    if (fields.flight_status !== undefined) push('flight_status', fields.flight_status);
    if (fields.route !== undefined) push('route', fields.route);
    if (fields.route_distance !== undefined) push('route_distance', fields.route_distance);
    if (fields.baggage_claim !== undefined) push('baggage_claim', fields.baggage_claim);
    if (fields.gate_origin !== undefined) push('gate_origin', fields.gate_origin);
    if (fields.gate_destination !== undefined) push('gate_destination', fields.gate_destination);
    if (fields.terminal_origin !== undefined) push('terminal_origin', fields.terminal_origin);
    if (fields.terminal_destination !== undefined) push('terminal_destination', fields.terminal_destination);
    if (fields.actual_runway_off !== undefined) push('actual_runway_off', fields.actual_runway_off);
    if (fields.actual_runway_on !== undefined) push('actual_runway_on', fields.actual_runway_on);
    if (fields.progress_percent !== undefined) push('progress_percent', fields.progress_percent);
    if (fields.filed_airspeed !== undefined) push('filed_airspeed', fields.filed_airspeed);
    if (fields.blocked !== undefined) push('blocked', fields.blocked);
    if (fields.diverted !== undefined) push('diverted', fields.diverted);
    if (fields.cancelled !== undefined) push('cancelled', fields.cancelled);
    if (fields.departure_delay !== undefined) push('departure_delay', fields.departure_delay);
    if (fields.arrival_delay !== undefined) push('arrival_delay', fields.arrival_delay);

    if (sets.length === 0) return;

    const query = `UPDATE flight_routes_history SET ${sets.join(', ')} WHERE id = $${idx}`;
    values.push(id);
    await this.db.none(query, values);
  }

  async getHistoricalRoutes(
    icao24: string,
    startDate?: Date | null,
    endDate?: Date | null,
    limit: number = 100,
  ): Promise<any[]> {
    let query = `
      SELECT
        callsign,
        departure_icao, departure_iata, departure_name,
        arrival_icao, arrival_iata, arrival_name,
        source,
        actual_flight_start, actual_flight_end, first_seen, last_seen,
        created_at
      FROM flight_routes_history
      WHERE icao24 = $1
    `;
    const params: any[] = [icao24];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND actual_flight_start >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND actual_flight_end <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY actual_flight_start DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const results = await this.db.query(query, params);

    return results.map((row: any) => ({
      callsign: row.callsign,
      departureAirport: {
        iata: row.departure_iata,
        icao: row.departure_icao,
        name: row.departure_name,
      },
      arrivalAirport: {
        iata: row.arrival_iata,
        icao: row.arrival_icao,
        name: row.arrival_name,
      },
      flightData: {
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        actualStart: row.actual_flight_start,
        actualEnd: row.actual_flight_end,
      },
      recordedAt: row.created_at,
    }));
  }

  async getLatestRouteHistory(icao24: string, callsign?: string | null): Promise<any> {
    const query = `
      SELECT aircraft_type, aircraft_model
      FROM flight_routes_history
      WHERE icao24 = $1
        AND (callsign = $2 OR $2 IS NULL)
        AND (aircraft_type IS NOT NULL OR aircraft_model IS NOT NULL)
      ORDER BY created_at DESC, actual_flight_start DESC
      LIMIT 1
    `;

    const result = await this.db.oneOrNone(query, [icao24, callsign]);
    return result;
  }

  async getRouteStats(): Promise<any> {
    const query = `
      SELECT
        (SELECT COUNT(*) FROM flight_routes_history) as history_total,
        (SELECT COUNT(*) FROM flight_routes_history
         WHERE (departure_icao IS NOT NULL OR departure_iata IS NOT NULL)
           AND (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL)) as history_complete,
        (SELECT COUNT(*) FROM flight_routes_cache) as cache_total,
        (SELECT COUNT(*) FROM flight_routes_cache
         WHERE (departure_icao IS NOT NULL OR departure_iata IS NOT NULL)
           AND (arrival_icao IS NOT NULL OR arrival_iata IS NOT NULL)) as cache_complete
    `;
    return this.db.one(query);
  }
}

export default RouteRepository;
