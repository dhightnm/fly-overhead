/**
 * Aircraft state tuple structure aligned with airplanes.live/OpenSky data.
 * Keeping as `any[]` for now until typed tuple refactor lands.
 */
export type AircraftStateArray = any[];

export interface AircraftStateRecord {
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  time_position: number | null;
  last_contact: number | null;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean | null;
  position_source: number | null;
  category: number | null;
  aircraft_type: string | null;
  aircraft_description: string | null;
  registration: string | null;
  emergency_status: string | null;
}
