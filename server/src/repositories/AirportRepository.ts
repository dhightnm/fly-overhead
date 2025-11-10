import pgPromise from 'pg-promise';
import type { Airport, Navaid } from '../types/database.types';
import PostGISService from '../services/PostGISService';

/**
 * Repository for airport and navaid queries
 */
class AirportRepository {
  private db: pgPromise.IDatabase<any>;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore - postgis reserved for future use
  private _postgis: PostGISService;

  constructor(db: pgPromise.IDatabase<any>, postgis: PostGISService) {
    this.db = db;
    this._postgis = postgis;
  }

  async findAirportsNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number = 50,
    airportType: string | null = null
  ): Promise<Airport[]> {
    let query = `
      SELECT *,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000 as distance_km
      FROM airports
      WHERE geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
    `;

    const params: any[] = [latitude, longitude, radiusKm * 1000];

    if (airportType) {
      query += ' AND type = $4';
      params.push(airportType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    const results = await this.db.query<Airport>(query, params) as unknown as Airport[];
    return results;
  }

  async findAirportByCode(code: string): Promise<Airport | null> {
    const query = `
      SELECT * FROM airports
      WHERE UPPER(iata_code) = UPPER($1)
         OR UPPER(gps_code) = UPPER($1)
         OR UPPER(ident) = UPPER($1)
      LIMIT 1;
    `;
    return this.db.oneOrNone<Airport>(query, [code]);
  }

  async findAirportsInBounds(
    latmin: number,
    lonmin: number,
    latmax: number,
    lonmax: number,
    airportType: string | null = null,
    limit: number = 100
  ): Promise<Airport[]> {
    let query = `
      SELECT
        id,
        airport_id,
        ident,
        type,
        name,
        latitude_deg,
        longitude_deg,
        elevation_ft,
        iso_country,
        iso_region,
        municipality,
        iata_code,
        gps_code,
        runways,
        frequencies,
        ST_X(geom::geometry) as lon,
        ST_Y(geom::geometry) as lat
      FROM airports
      WHERE geom IS NOT NULL
        AND latitude_deg BETWEEN $1 AND $3
        AND longitude_deg BETWEEN $2 AND $4
    `;

    const params: any[] = [latmin, lonmin, latmax, lonmax];

    if (airportType) {
      query += ' AND type = $5';
      params.push(airportType);
      query += ' ORDER BY type, name LIMIT $6';
      params.push(limit);
    } else {
      query += ' ORDER BY type, name LIMIT $5';
      params.push(limit);
    }

    const results = await this.db.query<Airport>(query, params) as unknown as Airport[];
    return results;
  }

  async findNavaidsNearPoint(
    latitude: number,
    longitude: number,
    radiusKm: number = 50,
    navaidType: string | null = null
  ): Promise<Navaid[]> {
    let query = `
      SELECT *,
        ST_Distance(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        ) / 1000 as distance_km
      FROM navaids
      WHERE geom IS NOT NULL
        AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          $3
        )
    `;

    const params: any[] = [latitude, longitude, radiusKm * 1000];

    if (navaidType) {
      query += ' AND type = $4';
      params.push(navaidType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    const results = await this.db.query<Navaid>(query, params) as unknown as Navaid[];
    return results;
  }

  async searchAirports(searchTerm: string, limit: number = 10): Promise<Airport[]> {
    const query = `
      SELECT * FROM airports
      WHERE UPPER(name) LIKE UPPER($1)
         OR UPPER(iata_code) LIKE UPPER($1)
         OR UPPER(gps_code) LIKE UPPER($1)
         OR UPPER(ident) LIKE UPPER($1)
         OR UPPER(municipality) LIKE UPPER($1)
      ORDER BY
        CASE
          WHEN UPPER(iata_code) = UPPER($2) THEN 1
          WHEN UPPER(ident) = UPPER($2) THEN 2
          WHEN UPPER(gps_code) = UPPER($2) THEN 3
          ELSE 4
        END,
        name
      LIMIT $3;
    `;
    const results = await this.db.query<Airport>(query, [`%${searchTerm}%`, searchTerm, limit]) as unknown as Airport[];
    return results;
  }
}

export default AirportRepository;

