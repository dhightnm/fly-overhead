CREATE TABLE IF NOT EXISTS aircraft_states (
    id SERIAL PRIMARY KEY,
    icao24 TEXT NOT NULL, 
    callsign TEXT,
    origin_country TEXT,
    time_position INT,
    last_contact INT,
    longitude FLOAT8,
    latitude FLOAT8,
    baro_altitude FLOAT8,
    on_ground BOOLEAN,
    velocity FLOAT8,
    true_track FLOAT8,
    vertical_rate FLOAT8,
    sensors INT[],
    geo_altitude FLOAT8,
    squawk TEXT,
    spi BOOLEAN,
    position_source INT CHECK (position_source BETWEEN 0 AND 3),
    category INT CHECK (category BETWEEN 0 AND 19),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_icao24 ON aircraft_states(icao24);
CREATE UNIQUE INDEX idx_lat_lon ON aircraft_states(latitude, longitude);
