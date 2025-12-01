import pgPromise from 'pg-promise';
import logger from '../utils/logger';

export interface METARData {
  id?: number;
  airport_ident: string;
  observation_time: Date;
  raw_text: string;
  temperature_c?: number | null;
  dewpoint_c?: number | null;
  wind_dir_deg?: number | null;
  wind_speed_kt?: number | null;
  wind_gust_kt?: number | null;
  visibility_statute_mi?: number | null;
  altim_in_hg?: number | null;
  sea_level_pressure_mb?: number | null;
  sky_condition?: any[] | null;
  flight_category?: string | null;
  metar_type?: string | null;
  elevation_m?: number | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface TAFData {
  id?: number;
  airport_ident: string;
  issue_time: Date;
  valid_time_from: Date;
  valid_time_to: Date;
  raw_text: string;
  forecast_data?: any | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface WeatherCacheEntry {
  airport_ident: string;
  latest_metar_id?: number | null;
  latest_taf_id?: number | null;
  last_updated?: Date;
  next_update_due?: Date | null;
}

class WeatherRepository {
  private db: pgPromise.IDatabase<any>;

  constructor(db: pgPromise.IDatabase<any>) {
    this.db = db;
  }

  async saveMETAR(metar: METARData): Promise<METARData> {
    const query = `
      INSERT INTO metar_observations (
        airport_ident,
        observation_time,
        raw_text,
        temperature_c,
        dewpoint_c,
        wind_dir_deg,
        wind_speed_kt,
        wind_gust_kt,
        visibility_statute_mi,
        altim_in_hg,
        sea_level_pressure_mb,
        sky_condition,
        flight_category,
        metar_type,
        elevation_m
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      RETURNING id, airport_ident, observation_time, raw_text, created_at;
    `;

    const result = await this.db.one<METARData>(query, [
      metar.airport_ident,
      metar.observation_time,
      metar.raw_text,
      metar.temperature_c || null,
      metar.dewpoint_c || null,
      metar.wind_dir_deg || null,
      metar.wind_speed_kt || null,
      metar.wind_gust_kt || null,
      metar.visibility_statute_mi || null,
      metar.altim_in_hg || null,
      metar.sea_level_pressure_mb || null,
      metar.sky_condition ? JSON.stringify(metar.sky_condition) : '[]',
      metar.flight_category || null,
      metar.metar_type || null,
      metar.elevation_m || null,
    ]);

    return result;
  }

  async getLatestMETAR(airportIdent: string): Promise<METARData | null> {
    const query = `
      SELECT m.*
      FROM metar_observations m
      WHERE m.airport_ident = $1
      ORDER BY m.observation_time DESC
      LIMIT 1;
    `;

    try {
      const result = await this.db.oneOrNone<METARData>(query, [airportIdent]);
      if (result && result.sky_condition) {
        result.sky_condition = typeof result.sky_condition === 'string'
          ? JSON.parse(result.sky_condition)
          : result.sky_condition;
      }
      return result;
    } catch (error) {
      logger.error('Error fetching latest METAR', {
        airport_ident: airportIdent,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getMETARHistory(airportIdent: string, hours: number = 24): Promise<METARData[]> {
    const query = `
      SELECT m.*
      FROM metar_observations m
      WHERE m.airport_ident = $1
        AND m.observation_time >= NOW() - INTERVAL '${hours} hours'
      ORDER BY m.observation_time DESC;
    `;

    try {
      const results = await this.db.manyOrNone<METARData>(query, [airportIdent]);
      return results.map((r) => {
        if (r.sky_condition && typeof r.sky_condition === 'string') {
          return {
            ...r,
            sky_condition: JSON.parse(r.sky_condition),
          };
        }
        return r;
      });
    } catch (error) {
      logger.error('Error fetching METAR history', {
        airport_ident: airportIdent,
        hours,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async saveTAF(taf: TAFData): Promise<TAFData> {
    const query = `
      INSERT INTO taf_forecasts (
        airport_ident,
        issue_time,
        valid_time_from,
        valid_time_to,
        raw_text,
        forecast_data
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, airport_ident, issue_time, valid_time_from, valid_time_to, raw_text, created_at;
    `;

    const result = await this.db.one<TAFData>(query, [
      taf.airport_ident,
      taf.issue_time,
      taf.valid_time_from,
      taf.valid_time_to,
      taf.raw_text,
      taf.forecast_data ? JSON.stringify(taf.forecast_data) : '{}',
    ]);

    return result;
  }

  async getLatestTAF(airportIdent: string): Promise<TAFData | null> {
    const query = `
      SELECT t.*
      FROM taf_forecasts t
      WHERE t.airport_ident = $1
        AND t.valid_time_to >= NOW()
      ORDER BY t.issue_time DESC
      LIMIT 1;
    `;

    try {
      const result = await this.db.oneOrNone<TAFData>(query, [airportIdent]);
      if (result && result.forecast_data) {
        result.forecast_data = typeof result.forecast_data === 'string'
          ? JSON.parse(result.forecast_data)
          : result.forecast_data;
      }
      return result;
    } catch (error) {
      logger.error('Error fetching latest TAF', {
        airport_ident: airportIdent,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async updateWeatherCache(
    airportIdent: string,
    metarId?: number | null,
    tafId?: number | null,
    nextUpdateMinutes: number = 30,
  ): Promise<void> {
    const query = `
      INSERT INTO airport_weather_cache (
        airport_ident,
        latest_metar_id,
        latest_taf_id,
        last_updated,
        next_update_due
      ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '${nextUpdateMinutes} minutes')
      ON CONFLICT (airport_ident)
      DO UPDATE SET
        latest_metar_id = COALESCE(EXCLUDED.latest_metar_id, airport_weather_cache.latest_metar_id),
        latest_taf_id = COALESCE(EXCLUDED.latest_taf_id, airport_weather_cache.latest_taf_id),
        last_updated = CURRENT_TIMESTAMP,
        next_update_due = CURRENT_TIMESTAMP + INTERVAL '${nextUpdateMinutes} minutes';
    `;

    await this.db.none(query, [airportIdent, metarId || null, tafId || null]);
  }

  async getWeatherCache(airportIdent: string): Promise<WeatherCacheEntry | null> {
    const query = `
      SELECT *
      FROM airport_weather_cache
      WHERE airport_ident = $1;
    `;

    return this.db.oneOrNone<WeatherCacheEntry>(query, [airportIdent]);
  }

  async cleanupOldWeatherData(retentionDays: number = 30): Promise<number> {
    const query = `
      DELETE FROM metar_observations
      WHERE observation_time < NOW() - INTERVAL '${retentionDays} days';
    `;

    const result = await this.db.result(query);
    return result.rowCount || 0;
  }
}

export default WeatherRepository;
