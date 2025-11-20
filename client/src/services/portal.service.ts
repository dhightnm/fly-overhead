/**
 * Portal service - handles all portal-related API calls
 */
import api from './api';
import type { Aircraft } from '../types';

export interface Feeder {
  feeder_id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface PortalStats {
  totalAircraft: number;
  activeFeeders: number;
  totalApiKeys: number;
  recentAircraft: number;
}

export interface UserFeedersResponse {
  feeders: Feeder[];
}

export interface UserAircraftResponse {
  aircraft: Aircraft[];
  total: number;
}

export interface PortalStatsResponse {
  stats: PortalStats;
}

class PortalService {
  /**
   * Get user's associated feeders
   */
  async getUserFeeders(): Promise<Feeder[]> {
    const response = await api.get<UserFeedersResponse>('/api/portal/feeders');
    return response.data.feeders;
  }

  /**
   * Get aircraft from user's feeders
   */
  async getUserAircraft(limit?: number, offset?: number): Promise<UserAircraftResponse> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', limit.toString());
    if (offset) params.append('offset', offset.toString());
    
    const response = await api.get<UserAircraftResponse>(
      `/api/portal/aircraft?${params.toString()}`
    );
    return response.data;
  }

  /**
   * Get portal statistics
   */
  async getPortalStats(): Promise<PortalStats> {
    const response = await api.get<PortalStatsResponse>('/api/portal/stats');
    return response.data.stats;
  }
}

export const portalService = new PortalService();

