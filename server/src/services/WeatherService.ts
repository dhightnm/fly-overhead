import logger from '../utils/logger';
import aviationWeatherService from './AviationWeatherService';
import postgresRepository from '../repositories';
import type { METARData, TAFData } from '../repositories/WeatherRepository';

export interface ParsedMETAR {
  raw_text: string;
  airport_ident: string;
  observation_time: Date;
  temperature_c?: number;
  dewpoint_c?: number;
  wind_dir_deg?: number;
  wind_speed_kt?: number;
  wind_gust_kt?: number;
  visibility_statute_mi?: number;
  altim_in_hg?: number;
  sea_level_pressure_mb?: number;
  sky_condition?: any[];
  flight_category?: string;
  metar_type?: string;
  elevation_m?: number;
}

export interface ParsedTAF {
  raw_text: string;
  airport_ident: string;
  issue_time: Date;
  valid_time_from: Date;
  valid_time_to: Date;
  forecast_data?: any;
}

class WeatherService {
  async getMETAR(airportIdent: string, useCache: boolean = true): Promise<METARData | null> {
    try {
      if (useCache) {
        const cached = await postgresRepository.getLatestMETAR(airportIdent);
        if (cached) {
          const cacheAge = Date.now() - new Date(cached.observation_time).getTime();
          const maxAge = 30 * 60 * 1000;
          if (cacheAge < maxAge) {
            logger.debug('Returning cached METAR', { airport_ident: airportIdent });
            return cached;
          }
        }
      }

      const awcMetar = await aviationWeatherService.getMETAR(airportIdent);
      if (!awcMetar) {
        logger.debug('No METAR data available from AWC', { airport_ident: airportIdent });
        return null;
      }

      const parsed = this.parseMETARFromAWC(awcMetar, airportIdent);
      const saved = await postgresRepository.saveMETAR(parsed);
      await postgresRepository.updateWeatherCache(airportIdent, saved.id || null, null, 30);

      return saved;
    } catch (error) {
      logger.error('Error fetching METAR', {
        airport_ident: airportIdent,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getTAF(airportIdent: string, useCache: boolean = true): Promise<TAFData | null> {
    try {
      if (useCache) {
        const cached = await postgresRepository.getLatestTAF(airportIdent);
        if (cached) {
          const validUntil = new Date(cached.valid_time_to).getTime();
          if (validUntil > Date.now()) {
            logger.debug('Returning cached TAF', { airport_ident: airportIdent });
            return cached;
          }
        }
      }

      const awcTaf = await aviationWeatherService.getTAF(airportIdent);
      if (!awcTaf) {
        logger.debug('No TAF data available from AWC', { airport_ident: airportIdent });
        return null;
      }

      const parsed = this.parseTAFFromAWC(awcTaf, airportIdent);
      const saved = await postgresRepository.saveTAF(parsed);
      await postgresRepository.updateWeatherCache(airportIdent, null, saved.id || null, 30);

      return saved;
    } catch (error) {
      logger.error('Error fetching TAF', {
        airport_ident: airportIdent,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getHistoricalMETAR(airportIdent: string, startDate: Date, endDate: Date): Promise<METARData[]> {
    try {
      const hours = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
      return await postgresRepository.getMETARHistory(airportIdent, hours);
    } catch (error) {
      logger.error('Error fetching historical METAR', {
        airport_ident: airportIdent,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getWeatherSummary(
    airportIdent: string,
    useCache: boolean = true,
  ): Promise<{ metar: METARData | null; taf: TAFData | null }> {
    const [metar, taf] = await Promise.all([
      this.getMETAR(airportIdent, useCache),
      this.getTAF(airportIdent, useCache),
    ]);

    return { metar, taf };
  }

  parseMETARFromAWC(awcData: any, airportIdent: string): ParsedMETAR {
    let observationTime: Date;
    if (awcData.obsTime) {
      observationTime = typeof awcData.obsTime === 'number' ? new Date(awcData.obsTime * 1000) : new Date(awcData.obsTime);
    } else if (awcData.reportTime) {
      observationTime = new Date(awcData.reportTime);
    } else {
      observationTime = new Date();
    }

    const clouds = Array.isArray(awcData.clouds)
      ? awcData.clouds.map((cloud: any) => ({
        cover: cloud.cover || null,
        base: cloud.base || null,
        top: cloud.top || null,
      }))
      : [];

    const parseVisibility = (visib: any): number | null => {
      if (!visib) return null;
      if (typeof visib === 'number') return visib;
      if (typeof visib === 'string') {
        const cleaned = visib.replace(/[+<>]/g, '');
        const parsed = parseFloat(cleaned);
        return Number.isNaN(parsed) ? null : parsed;
      }
      return null;
    };

    const parseAltimeter = (altim: any): number | null => {
      if (!altim) return null;
      if (typeof altim === 'number') {
        return altim / 100;
      }
      if (typeof altim === 'string') {
        const parsed = parseFloat(altim);
        return Number.isNaN(parsed) ? null : parsed / 100;
      }
      return null;
    };

    return {
      raw_text: awcData.rawOb || '',
      airport_ident: airportIdent,
      observation_time: observationTime,
      temperature_c: awcData.temp ?? null,
      dewpoint_c: awcData.dewp ?? null,
      wind_dir_deg: awcData.wdir ?? null,
      wind_speed_kt: awcData.wspd ?? null,
      wind_gust_kt: awcData.wgst ?? null,
      visibility_statute_mi: parseVisibility(awcData.visib),
      altim_in_hg: parseAltimeter(awcData.altim),
      sea_level_pressure_mb: awcData.slp ?? null,
      sky_condition: clouds.length > 0 ? clouds : null,
      flight_category: awcData.fltCat ?? null,
      metar_type: awcData.metarType ?? null,
      elevation_m: awcData.elev ?? null,
    };
  }

  parseTAFFromAWC(awcData: any, airportIdent: string): ParsedTAF {
    let issueTime: Date;
    if (awcData.issueTime) {
      if (typeof awcData.issueTime === 'number') {
        issueTime = new Date(awcData.issueTime * 1000);
      } else {
        issueTime = new Date(awcData.issueTime);
      }
    } else {
      issueTime = new Date();
    }

    let validFrom: Date;
    if (awcData.validTimeFrom) {
      if (typeof awcData.validTimeFrom === 'number') {
        validFrom = new Date(awcData.validTimeFrom * 1000);
      } else {
        validFrom = new Date(awcData.validTimeFrom);
      }
    } else {
      validFrom = new Date();
    }

    let validTo: Date;
    if (awcData.validTimeTo) {
      if (typeof awcData.validTimeTo === 'number') {
        validTo = new Date(awcData.validTimeTo * 1000);
      } else {
        validTo = new Date(awcData.validTimeTo);
      }
    } else {
      validTo = new Date(validFrom.getTime() + 24 * 60 * 60 * 1000);
    }

    return {
      raw_text: awcData.rawTAF || '',
      airport_ident: airportIdent,
      issue_time: issueTime,
      valid_time_from: validFrom,
      valid_time_to: validTo,
      forecast_data: {
        remarks: awcData.remarks || null,
        lat: awcData.lat || null,
        lon: awcData.lon || null,
        elev: awcData.elev || null,
      },
    };
  }
}

const weatherService = new WeatherService();
export default weatherService;
