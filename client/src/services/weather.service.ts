/**
 * Weather service - handles all weather-related API calls
 */
import api from './api';

export interface METARData {
  id: number;
  airport_ident: string;
  observation_time: string;
  raw_text: string;
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
  created_at: string;
}

export interface DecodedMETAR {
  temperature: string;
  dewpoint: string;
  wind: string;
  visibility: string;
  altimeter: string;
  clouds: string[];
  flightCategoryLabel: string | null;
  summary: string;
}

export interface TAFData {
  id: number;
  airport_ident: string;
  issue_time: string;
  valid_time_from: string;
  valid_time_to: string;
  raw_text: string;
  forecast_data?: any;
  created_at: string;
}

export interface DecodedTAF {
  validPeriod: string;
  summary: string;
}

export interface WeatherSummary {
  airport: {
    ident: string;
    name: string;
    iata_code?: string;
    elevation_ft?: number;
    latitude_deg?: number;
    longitude_deg?: number;
  };
  current: {
    observation_time: string;
    raw_text: string;
    temperature_c?: number;
    dewpoint_c?: number;
    wind_dir_deg?: number;
    wind_speed_kt?: number;
    wind_gust_kt?: number;
    visibility_statute_mi?: number;
    altim_in_hg?: number;
    flight_category?: string;
    decoded?: DecodedMETAR | null;
  } | null;
  forecast: {
    issue_time: string;
    valid_time_from: string;
    valid_time_to: string;
    raw_text: string;
    decoded?: DecodedTAF | null;
  } | null;
  available: {
    metar: boolean;
    taf: boolean;
  };
}

export interface WeatherHistoryResponse {
  airport: {
    ident: string;
    name: string;
    iata_code?: string;
  };
  hours: number;
  count: number;
  history: METARData[];
}

class WeatherService {
  /**
   * Get current METAR for an airport
   */
  async getMETAR(airportCode: string, useCache: boolean = true): Promise<METARData> {
    const response = await api.get<{
      airport: any;
      metar: METARData;
    }>(`/api/weather/airport/${airportCode}/metar`, {
      params: { useCache: useCache.toString() },
    });
    return response.data.metar;
  }

  /**
   * Get current TAF for an airport
   */
  async getTAF(airportCode: string, useCache: boolean = true): Promise<TAFData> {
    const response = await api.get<{
      airport: any;
      taf: TAFData;
    }>(`/api/weather/airport/${airportCode}/taf`, {
      params: { useCache: useCache.toString() },
    });
    return response.data.taf;
  }

  /**
   * Get historical METAR data for an airport (EFB only)
   */
  async getWeatherHistory(airportCode: string, hours: number = 24): Promise<WeatherHistoryResponse> {
    const response = await api.get<WeatherHistoryResponse>(
      `/api/weather/airport/${airportCode}/history`,
      {
        params: { hours: hours.toString() },
      },
    );
    return response.data;
  }

  /**
   * Get weather summary (METAR + TAF) for an airport
   */
  async getWeatherSummary(airportCode: string, useCache: boolean = true): Promise<WeatherSummary> {
    const response = await api.get<WeatherSummary>(
      `/api/weather/airport/${airportCode}/summary`,
      {
        params: { useCache: useCache.toString() },
      },
    );
    return response.data;
  }
}

export const weatherService = new WeatherService();
