/**
 * Repository for airport and navaid queries
 */
class AirportRepository {
  constructor(db, postgis) {
    this.db = db;
    this.postgis = postgis;
  }

  async findAirportsNearPoint(latitude, longitude, radiusKm = 50, airportType = null) {
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

    const params = [latitude, longitude, radiusKm * 1000];

    if (airportType) {
      query += ' AND type = $4';
      params.push(airportType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    return this.db.query(query, params);
  }

  async findAirportByCode(code) {
    const query = `
      SELECT * FROM airports
      WHERE UPPER(iata_code) = UPPER($1)
         OR UPPER(gps_code) = UPPER($1)
         OR UPPER(ident) = UPPER($1)
      LIMIT 1;
    `;
    return this.db.oneOrNone(query, [code]);
  }

  async findAirportsInBounds(latmin, lonmin, latmax, lonmax, airportType = null, limit = 100) {
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

    const params = [latmin, lonmin, latmax, lonmax];

    if (airportType) {
      query += ' AND type = $5';
      params.push(airportType);
      query += ' ORDER BY type, name LIMIT $6';
      params.push(limit);
    } else {
      query += ' ORDER BY type, name LIMIT $5';
      params.push(limit);
    }

    return this.db.query(query, params);
  }

  async findNavaidsNearPoint(latitude, longitude, radiusKm = 50, navaidType = null) {
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

    const params = [latitude, longitude, radiusKm * 1000];

    if (navaidType) {
      query += ' AND type = $4';
      params.push(navaidType);
    }

    query += ' ORDER BY distance_km ASC LIMIT 50;';

    return this.db.query(query, params);
  }

  async searchAirports(searchTerm, limit = 10) {
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
    return this.db.query(query, [`%${searchTerm}%`, searchTerm, limit]);
  }
}

module.exports = AirportRepository;
