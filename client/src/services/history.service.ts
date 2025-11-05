/**
 * Flight history service - handles historical flight data API calls
 */
import api from './api';
import type { FlightPathResponse } from '../types';

class HistoryService {
  /**
   * Get flight history for a specific aircraft
   */
  async getFlightHistory(
    icao24: string,
    startTime?: string | null,
    endTime?: string | null
  ): Promise<FlightPathResponse> {
    const params: Record<string, string> = {};
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const response = await api.get<FlightPathResponse>(`/api/history/${icao24}`, { params });
    return response.data;
  }

  /**
   * Get flight path trajectory data for visualization
   */
  async getFlightPath(
    icao24: string,
    startTime?: string | null,
    endTime?: string | null
  ): Promise<FlightPathResponse> {
    return this.getFlightHistory(icao24, startTime, endTime);
  }
}

export const historyService = new HistoryService();

