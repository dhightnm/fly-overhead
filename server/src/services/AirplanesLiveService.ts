import { AxiosError } from 'axios';
import NodeCache from 'node-cache';
import config from '../config';
import logger from '../utils/logger';
import httpClient from '../utils/httpClient';

export interface AirplanesLiveAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string; // registration
  t?: string; // aircraft type (ICAO designator)
  desc?: string; // aircraft description
  ownOp?: string; // owner/operator
  year?: string; // year built
  alt_baro?: number | string;
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  nav_heading?: number;
  lat?: number;
  lon?: number;
  nic?: number;
  rc?: number;
  seen_pos?: number;
  version?: number;
  nic_baro?: number;
  nac_p?: number;
  nac_v?: number;
  sil?: number;
  sil_type?: string;
  gva?: number;
  sda?: number;
  mlat?: string[];
  tisb?: string[];
  messages?: number;
  seen?: number;
  rssi?: number;
}

interface AirplanesLiveResponse {
  ac: AirplanesLiveAircraft[];
  total: number;
  now: number;
  ctime: number;
  ptime: number;
}

interface PointRequest {
  lat: number;
  lon: number;
  radiusNm: number;
}

/**
 * Service for interacting with airplanes.live API
 * Rate limit: 1 request per second
 * Max radius: 250 nautical miles
 */
class AirplanesLiveService {
  private baseUrl: string;

  private lastRequestTime: number = 0;

  private readonly MIN_REQUEST_INTERVAL_MS = 1000; // 1 request per second

  private readonly MAX_RADIUS_NM = 250;

  // Cache most recent response for 2 seconds
  private responseCache: NodeCache;

  // Pending requests queue to prevent duplicate simultaneous requests
  private pendingRequests: Map<string, Promise<AirplanesLiveResponse>> = new Map();

  constructor() {
    this.baseUrl = config.external.airplanesLive?.baseUrl || 'https://api.airplanes.live/v2';

    // Response cache REMOVED - no longer caching raw API responses
    // Caching happens at database level after unit conversion
    this.responseCache = new NodeCache({
      stdTTL: 2,
      checkperiod: 3,
      useClones: false,
    });

    logger.info('AirplanesLiveService initialized', {
      baseUrl: this.baseUrl,
      unitConversion: 'ENABLED (ft→m, ft/min→m/s)',
      rateLimit: '1 req/sec',
      maxRadius: '250nm',
      caching: 'DISABLED (database-level only)',
    });
  }

  /**
   * Enforce rate limiting - wait if necessary
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      const waitTime = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms before next request`);
      await new Promise((resolve) => {
        setTimeout(() => resolve(undefined), waitTime);
      });
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Get aircraft within radius of a point
   * Automatically enforces 1 req/sec rate limit and caches responses
   */
  async getAircraftNearPoint(request: PointRequest): Promise<AirplanesLiveResponse> {
    // Clamp radius to max allowed
    const radiusNm = Math.min(request.radiusNm, this.MAX_RADIUS_NM);

    if (radiusNm !== request.radiusNm) {
      logger.warn(`Radius clamped from ${request.radiusNm}nm to ${radiusNm}nm (max: ${this.MAX_RADIUS_NM}nm)`);
    }

    // Create cache key for deduplication only (no caching of raw responses)
    const cacheKey = `${request.lat.toFixed(2)}_${request.lon.toFixed(2)}_${radiusNm}`;

    // Check if there's already a pending request for this location (prevent duplicate simultaneous requests)
    const pendingRequest = this.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      logger.debug(`Reusing pending request for ${cacheKey}`);
      return pendingRequest;
    }

    // Create new request (NO RESPONSE CACHING - data must be fresh for accurate conversions)
    const requestPromise = this._fetchAircraftNearPoint(request.lat, request.lon, radiusNm);

    // Store in pending requests
    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      // Remove from pending requests
      this.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Internal method to fetch aircraft data with rate limiting
   * Includes retry logic for transient 500 errors
   */
  private async _fetchAircraftNearPoint(
    lat: number,
    lon: number,
    radiusNm: number,
    retryCount = 0,
  ): Promise<AirplanesLiveResponse> {
    // Enforce rate limit
    await this.enforceRateLimit();

    const maxRetries = 2; // Retry up to 2 times (3 total attempts)
    const retryDelayMs = 1000 * (retryCount + 1); // Exponential backoff: 1s, 2s

    try {
      const response = await httpClient.get<AirplanesLiveResponse>(`${this.baseUrl}/point/${lat}/${lon}/${radiusNm}`, {
        timeout: 10000, // explicit to match previous behavior
        retry: false, // manual retry logic below
        headers: {
          Accept: 'application/json',
          'User-Agent': 'FlyOverhead/1.0',
        },
      });

      logger.debug('airplanes.live API call', {
        lat,
        lon,
        radiusNm,
        aircraftCount: response.data.ac?.length || 0,
        totalAvailable: response.data.total,
      });

      // NO CACHING - return fresh data for accurate unit conversions
      // Database-level caching happens after conversion in aircraft.routes.ts
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      // Log detailed error information
      const errorDetails: any = {
        lat,
        lon,
        radiusNm,
        error: axiosError.message,
        status: axiosError.response?.status,
        code: axiosError.code,
      };

      // Include response body if available (helps debug API issues)
      if (axiosError.response?.data) {
        errorDetails.responseData = typeof axiosError.response.data === 'string'
          ? axiosError.response.data.substring(0, 200) // Truncate long responses
          : JSON.stringify(axiosError.response.data).substring(0, 200);
      }

      // Include response headers if available
      if (axiosError.response?.headers) {
        errorDetails.responseHeaders = {
          'content-type': axiosError.response.headers['content-type'],
          'x-ratelimit-remaining': axiosError.response.headers['x-ratelimit-remaining'],
          'retry-after': axiosError.response.headers['retry-after'],
        };
      }

      // Retry on 500 errors (server-side issues) up to maxRetries
      if (axiosError.response?.status === 500 && retryCount < maxRetries) {
        logger.warn(`airplanes.live API returned 500, retrying (${retryCount + 1}/${maxRetries})`, {
          lat,
          lon,
          radiusNm,
          retryAfter: `${retryDelayMs}ms`,
        });

        // Wait before retrying
        await new Promise((resolve) => {
          setTimeout(() => resolve(undefined), retryDelayMs);
        });

        // Retry the request
        return this._fetchAircraftNearPoint(lat, lon, radiusNm, retryCount + 1);
      }

      // Log error only on final failure or non-retryable errors
      // Use warn level for 500s (external service issue) to reduce noise
      if (axiosError.response?.status === 500) {
        logger.warn('airplanes.live API error (after retries)', {
          lat,
          lon,
          radiusNm,
          status: 500,
          message: 'API returned 500 error - external service issue',
        });
      } else {
        logger.error('Error fetching from airplanes.live', errorDetails);
      }

      // Return empty response on error (graceful degradation)
      return {
        ac: [],
        total: 0,
        now: Math.floor(Date.now() / 1000),
        ctime: Date.now(),
        ptime: 0,
      };
    }
  }

  /**
   * Convert airplanes.live aircraft format to our internal format with enriched data
   * Extended format includes additional metadata from airplanes.live
   *
   * IMPORTANT UNIT CONVERSIONS:
   * - airplanes.live provides altitude in FEET, we store in METERS (OpenSky standard)
   * - airplanes.live provides ground speed in KNOTS (no conversion needed)
   * - airplanes.live provides vertical rate in FT/MIN, we store in M/S
   *
   * Frontend will convert meters back to feet for display.
   */
  prepareStateForDatabase(aircraft: AirplanesLiveAircraft): any[] {
    const now = Math.floor(Date.now() / 1000);

    // Map airplanes.live format to OpenSky-like state format (indices 0-17)
    // Plus enriched data (indices 19+)
    // OpenSky format: [icao24, callsign, origin_country, time_position, last_contact,
    //                  longitude, latitude, baro_altitude, on_ground, velocity,
    //                  true_track, vertical_rate, sensors, geo_altitude, squawk,
    //                  spi, position_source, category, created_at]
    // Enriched: [aircraft_type, aircraft_description, registration, emergency_status,
    //            nav_qnh, nav_altitude_mcp, nav_heading, owner_operator, year_built]

    const callsign = aircraft.flight?.trim() || null;

    // airplanes.live sends altitude in FEET, but OpenSky uses METERS
    // Convert feet to meters: 1 ft = 0.3048 m
    let rawBaroAltitude: number | null = null;
    if (typeof aircraft.alt_baro === 'number') {
      rawBaroAltitude = aircraft.alt_baro;
    } else if (typeof aircraft.alt_baro === 'string') {
      rawBaroAltitude = parseFloat(aircraft.alt_baro);
    }
    let altitude = rawBaroAltitude;
    if (altitude !== null && !Number.isNaN(altitude)) {
      altitude *= 0.3048; // Convert feet to meters
    } else if (altitude !== null && Number.isNaN(altitude)) {
      altitude = null; // Handle "ground" or other string values that parseFloat to NaN
    }

    // airplanes.live sends ground speed in KNOTS (store/display as-is)
    let velocity: number | null = null;
    if (typeof aircraft.gs === 'number') {
      velocity = aircraft.gs;
    } else if (typeof aircraft.gs === 'string') {
      const parsedVelocity = parseFloat(aircraft.gs);
      velocity = Number.isNaN(parsedVelocity) ? null : parsedVelocity;
    }
    const track = aircraft.track || null;

    // Vertical rate in ft/min - convert to m/s for OpenSky compatibility
    // 1 ft/min = 0.00508 m/s
    let verticalRate = aircraft.baro_rate || null;
    if (verticalRate !== null) {
      verticalRate *= 0.00508; // Convert ft/min to m/s
    }

    // Geometric altitude also in feet - convert to meters
    let geoAltitude = aircraft.alt_geom || null;
    if (geoAltitude !== null) {
      geoAltitude *= 0.3048; // Convert feet to meters
    }

    const squawk = aircraft.squawk || null;

    // Determine if on ground (altitude < 30.48m (100ft) or ground speed < 50kt)
    const onGround = (altitude !== null && altitude < 30.48) || (velocity !== null && velocity < 50);

    // Map category if available
    let category: number | null = null;
    if (aircraft.category) {
      // airplanes.live uses A0-A7, B0-B7, C0-C3 categories similar to ADS-B
      // Map to OpenSky category numbers (0-19)
      category = this._mapCategory(aircraft.category);
    }

    // Enriched data from airplanes.live
    const aircraftType = aircraft.t || null; // ICAO type (e.g., "B738")
    const aircraftDescription = aircraft.desc || null; // Full description
    const registration = aircraft.r || null; // Tail number
    const emergencyStatus = aircraft.emergency || 'none'; // Emergency status
    const navQnh = aircraft.nav_qnh || null; // Barometric pressure (millibars)

    // Selected altitude in feet - convert to meters
    let navAltitudeMcp = aircraft.nav_altitude_mcp || null;
    if (navAltitudeMcp !== null) {
      navAltitudeMcp *= 0.3048; // Convert feet to meters
    }

    const navHeading = aircraft.nav_heading || null; // Selected heading
    const ownerOperator = (aircraft as any).ownOp || null; // Owner/operator
    const yearBuilt = (aircraft as any).year ? parseInt((aircraft as any).year, 10) : null; // Year built

    return [
      // Standard OpenSky-compatible fields (0-18)
      aircraft.hex.toLowerCase(), // 0: icao24
      callsign, // 1: callsign
      null, // 2: origin_country (not provided)
      aircraft.seen_pos !== undefined ? now - aircraft.seen_pos : now, // 3: time_position
      aircraft.seen !== undefined ? now - aircraft.seen : now, // 4: last_contact
      aircraft.lon || null, // 5: longitude
      aircraft.lat || null, // 6: latitude
      altitude, // 7: baro_altitude
      onGround, // 8: on_ground
      velocity, // 9: velocity
      track, // 10: true_track
      verticalRate, // 11: vertical_rate
      null, // 12: sensors (not provided)
      geoAltitude, // 13: geo_altitude
      squawk, // 14: squawk
      false, // 15: spi (special position identification)
      aircraft.mlat ? 2 : 0, // 16: position_source (0=ADS-B, 2=MLAT)
      category, // 17: category
      new Date(), // 18: created_at

      // Enriched fields from airplanes.live (19-27)
      aircraftType, // 19: aircraft_type
      aircraftDescription, // 20: aircraft_description
      registration, // 21: registration
      emergencyStatus, // 22: emergency_status
      navQnh, // 23: nav_qnh
      navAltitudeMcp, // 24: nav_altitude_mcp
      navHeading, // 25: nav_heading
      ownerOperator, // 26: owner_operator
      yearBuilt, // 27: year_built
    ];
  }

  /**
   * Map airplanes.live category to OpenSky category number
   */
  private _mapCategory(category: string): number | null {
    // airplanes.live categories: https://mode-s.org/decode/content/ads-b/5-airborne-position.html#aircraft-category
    const categoryMap: Record<string, number> = {
      // Category A - Light aircraft
      A0: 0, // No ADS-B category information
      A1: 1, // Light (< 15500 lbs)
      A2: 2, // Small (15500 to 75000 lbs)
      A3: 3, // Large (75000 to 300000 lbs)
      A4: 4, // High Vortex Large
      A5: 5, // Heavy (> 300000 lbs)
      A6: 6, // High Performance (> 5g and > 400kt)
      A7: 7, // Rotorcraft

      // Category B - Reserved
      B0: 8,
      B1: 9,
      B2: 10,
      B3: 11,
      B4: 12,
      B5: 13,
      B6: 14,
      B7: 15,

      // Category C - Surface vehicles
      C0: 16, // No info
      C1: 17, // Surface emergency vehicle
      C2: 18, // Surface service vehicle
      C3: 19, // Point obstacle
    };

    return categoryMap[category] || null;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      keys: this.responseCache.keys().length,
      stats: this.responseCache.getStats(),
    };
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      // Test with a small area (San Francisco)
      const testLat = 37.7749;
      const testLon = -122.4194;
      const testRadius = 50; // 50nm radius

      const result = await this.getAircraftNearPoint({
        lat: testLat,
        lon: testLon,
        radiusNm: testRadius,
      });

      return {
        success: true,
        message: `Successfully fetched ${result.ac.length} aircraft near SF`,
        data: {
          aircraftCount: result.ac.length,
          totalAvailable: result.total,
          sampleAircraft: result.ac.slice(0, 3),
        },
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        message: `Failed to connect: ${err.message}`,
      };
    }
  }
}

// Export singleton instance
const airplanesLiveService = new AirplanesLiveService();
export default airplanesLiveService;
