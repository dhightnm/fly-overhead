import logger from '../utils/logger';
import httpClient from '../utils/httpClient';

const AWC_BASE_URL = 'https://aviationweather.gov/api/data';
const REQUEST_TIMEOUT = 10000;

export interface AWCMETARResponse {
  icaoId?: string;
  obsTime?: string;
  reportTime?: string;
  temp?: number;
  dewp?: number;
  wdir?: number;
  wspd?: number;
  wgst?: number;
  visib?: number;
  altim?: number;
  slp?: number;
  clouds?: Array<{
    cover?: string;
    base?: number;
    top?: number;
  }>;
  rawOb?: string;
  fltCat?: string;
  metarType?: string;
  elev?: number;
}

export interface AWCTAFResponse {
  icaoId?: string;
  issueTime?: string;
  validTimeFrom?: string;
  validTimeTo?: string;
  rawTAF?: string;
  remarks?: string;
  lat?: number;
  lon?: number;
  elev?: number;
}

class AviationWeatherService {
  private requestCache: Map<string, { data: any; expiresAt: number }> = new Map();

  private readonly cacheTTL = 30 * 1000;

  async getMETAR(icao: string): Promise<AWCMETARResponse | null> {
    if (!icao || icao.length < 3) {
      logger.warn('Invalid ICAO code for METAR request', { icao });
      return null;
    }

    const cacheKey = `metar:${icao.toUpperCase()}`;
    const cached = this.requestCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug('Returning cached METAR request', { icao });
      return cached.data;
    }

    try {
      const url = `${AWC_BASE_URL}/metar`;
      const response = await httpClient.get(url, {
        params: {
          ids: icao.toUpperCase(),
          format: 'json',
          hours: 1,
        },
        headers: {
          'User-Agent': 'FlyOverhead/1.0',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT,
        retry: true,
      });

      if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
        logger.debug('No METAR data returned from AWC', { icao });
        return null;
      }

      const metar = response.data[0] as AWCMETARResponse;
      this.requestCache.set(cacheKey, {
        data: metar,
        expiresAt: Date.now() + this.cacheTTL,
      });

      logger.debug('METAR fetched from AWC', { icao, rawOb: metar.rawOb });
      return metar;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 429) {
        logger.warn('AWC rate limit hit for METAR', { icao });
      } else if (status === 204) {
        logger.debug('No METAR data available from AWC', { icao });
      } else {
        logger.warn('AWC METAR request failed', {
          icao,
          status,
          message: error?.message,
        });
      }
      return null;
    }
  }

  async getTAF(icao: string): Promise<AWCTAFResponse | null> {
    if (!icao || icao.length < 3) {
      logger.warn('Invalid ICAO code for TAF request', { icao });
      return null;
    }

    const cacheKey = `taf:${icao.toUpperCase()}`;
    const cached = this.requestCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      logger.debug('Returning cached TAF request', { icao });
      return cached.data;
    }

    try {
      const url = `${AWC_BASE_URL}/taf`;
      const response = await httpClient.get(url, {
        params: {
          ids: icao.toUpperCase(),
          format: 'json',
        },
        headers: {
          'User-Agent': 'FlyOverhead/1.0',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT,
        retry: true,
      });

      if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
        logger.debug('No TAF data returned from AWC', { icao });
        return null;
      }

      const taf = response.data[0] as AWCTAFResponse;
      this.requestCache.set(cacheKey, {
        data: taf,
        expiresAt: Date.now() + this.cacheTTL,
      });

      logger.debug('TAF fetched from AWC', { icao, rawTAF: taf.rawTAF });
      return taf;
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 429) {
        logger.warn('AWC rate limit hit for TAF', { icao });
      } else if (status === 204) {
        logger.debug('No TAF data available from AWC', { icao });
      } else {
        logger.warn('AWC TAF request failed', {
          icao,
          status,
          message: error?.message,
        });
      }
      return null;
    }
  }

  async getMultipleMETARs(icaos: string[]): Promise<AWCMETARResponse[]> {
    if (!icaos || icaos.length === 0) {
      return [];
    }

    const validIcaos = icaos
      .filter((icao) => icao && icao.length >= 3)
      .map((icao) => icao.toUpperCase())
      .slice(0, 400);

    if (validIcaos.length === 0) {
      return [];
    }

    try {
      const url = `${AWC_BASE_URL}/metar`;
      const response = await httpClient.get(url, {
        params: {
          ids: validIcaos.join(','),
          format: 'json',
          hours: 1,
        },
        headers: {
          'User-Agent': 'FlyOverhead/1.0',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT * 2,
        retry: true,
      });

      if (!response.data || !Array.isArray(response.data)) {
        return [];
      }

      logger.debug('Multiple METARs fetched from AWC', {
        requested: validIcaos.length,
        received: response.data.length,
      });

      return response.data as AWCMETARResponse[];
    } catch (error: any) {
      const status = error?.response?.status;
      logger.warn('AWC multiple METAR request failed', {
        count: validIcaos.length,
        status,
        message: error?.message,
      });
      return [];
    }
  }
}

const aviationWeatherService = new AviationWeatherService();
export default aviationWeatherService;
