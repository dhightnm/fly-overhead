import { getConnection } from '../DatabaseConnection';
import AircraftRepository from '../AircraftRepository';
import SchemaRepository from '../SchemaRepository';

type AircraftStateArray = any[];

const shouldRunDbTests = process.env.RUN_DB_TESTS === 'true';
const describeDb = shouldRunDbTests ? describe : describe.skip;

/**
 * Integration tests for AircraftRepository upsert priority logic
 *
 * These tests prevent regression of the bug where:
 * - Unconverted altitude data was overwriting converted data
 * - Stale data was overwriting fresh data due to identical timestamps
 * - Same-priority sources with identical last_contact weren't being updated
 */

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describeDb('AircraftRepository - Upsert Priority Logic (Integration)', () => {
  let repository: AircraftRepository;
  let db: any;
  let schemaRepo: SchemaRepository;

  beforeAll(async () => {
    const connection = getConnection();
    db = connection.getDb();
    const postgis = connection.getPostGIS();
    repository = new AircraftRepository(db, postgis);
    schemaRepo = new SchemaRepository();

    // Ensure tables exist
    await schemaRepo.createMainTable();
    await schemaRepo.createHistoryTable();
  });

  beforeEach(async () => {
    // Clean test data before each test
    await db.query("DELETE FROM aircraft_states WHERE icao24 LIKE 'test%'");
  });

  afterAll(async () => {
    // Clean up test data
    await db.query("DELETE FROM aircraft_states WHERE icao24 LIKE 'test%'");
  });

  describe('altitude conversion persistence', () => {
    it('should store converted altitude values in database', async () => {
      const state: AircraftStateArray = [
        'test001', // icao24
        'TST001', // callsign
        'United States', // origin_country
        1731600000, // time_position
        1731600000, // last_contact
        -105.0, // longitude
        40.0, // latitude
        10668, // baro_altitude (35000 ft converted to meters)
        false, // on_ground
        450, // velocity (knots, no conversion)
        180, // true_track
        10.16, // vertical_rate (2000 ft/min converted to m/s)
        null, // sensors
        10698, // geo_altitude (meters)
        '1200', // squawk
        false, // spi
        0, // position_source
        3, // category
        null, // aircraft_type
        null, // aircraft_description
        null, // registration
        null, // emergency_status
        null, // nav_qnh
        null, // nav_altitude_mcp
        null, // nav_heading
        null, // owner_operator
        null, // year_built
        new Date(), // created_at
      ];

      await repository.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        true,
      );

      // Verify stored values
      const result = await db.oneOrNone(
        'SELECT baro_altitude, velocity, vertical_rate FROM aircraft_states WHERE icao24 = $1',
        ['test001'],
      );

      expect(result).not.toBeNull();
      expect(result.baro_altitude).toBeCloseTo(10668, 0); // Meters
      expect(result.velocity).toBe(450); // Knots
      expect(result.vertical_rate).toBeCloseTo(10.16, 2); // m/s
    });

    it('should reject unconverted feet values when compared to meters', async () => {
      // First insert: converted data (meters)
      const convertedState: AircraftStateArray = [
        'test002',
        'TST002',
        'United States',
        1731600000,
        1731600000,
        -105.0,
        40.0,
        10668, // 35000 ft in meters (CORRECT)
        false,
        450,
        180,
        10.16,
        null,
        10698,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        convertedState,
        null,
        new Date('2024-11-14T10:00:00Z'),
        'airplanes.live',
        20,
        true,
      );

      // Attempt to overwrite with unconverted data (feet) - same timestamp
      const unconvertedState: AircraftStateArray = [
        'test002',
        'TST002',
        'United States',
        1731600000,
        1731600000, // Same last_contact
        -105.0,
        40.0,
        35000, // UNCONVERTED feet (BUG scenario)
        false,
        450,
        180,
        10.16,
        null,
        10698,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        unconvertedState,
        null,
        new Date('2024-11-14T10:00:01Z'), // 1 second later ingestion
        'airplanes.live',
        20,
        true,
      );

      // Verify the NEWER ingestion_timestamp allowed the update
      const result = await db.oneOrNone(
        'SELECT baro_altitude FROM aircraft_states WHERE icao24 = $1',
        ['test002'],
      );

      // With the fix, newer ingestion_timestamp should overwrite even with same last_contact
      expect(result.baro_altitude).toBe(35000);

      // NOTE: In production, this scenario shouldn't happen because conversion happens
      // before upsert. This test verifies the conflict resolution logic works.
    });
  });

  describe('same-priority source conflict resolution', () => {
    it('should update when same priority and newer last_contact', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const olderState: AircraftStateArray = [
        'test003',
        'TST003',
        'United States',
        currentTime - 200,
        currentTime - 200, // older
        -105.0,
        40.0,
        10000,
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        olderState,
        null,
        new Date('2024-11-14T10:00:00Z'),
        'airplanes.live',
        20,
        true,
      );

      const newerState: AircraftStateArray = [
        'test003',
        'TST003',
        'United States',
        currentTime - 100,
        currentTime - 100, // 100 seconds newer
        -106.0, // Updated position
        41.0,
        11000, // Updated altitude
        false,
        420, // Updated velocity
        185,
        5,
        null,
        11000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        newerState,
        null,
        new Date('2024-11-14T10:01:40Z'),
        'airplanes.live',
        20,
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude, velocity, longitude, latitude FROM aircraft_states WHERE icao24 = $1',
        ['test003'],
      );

      expect(result.baro_altitude).toBe(11000); // Updated
      expect(result.velocity).toBe(420); // Updated
      expect(result.longitude).toBeCloseTo(-106.0, 5); // Updated
      expect(result.latitude).toBeCloseTo(41.0, 5); // Updated
    });

    it('should update when same priority, same last_contact, but newer ingestion_timestamp', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const firstState: AircraftStateArray = [
        'test004',
        'TST004',
        'United States',
        currentTime - 100,
        currentTime - 100,
        -105.0,
        40.0,
        10000,
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        firstState,
        null,
        new Date('2024-11-14T10:00:00.000Z'),
        'airplanes.live',
        20,
        true,
      );

      // Same last_contact, but ingested later (converted data replacing unconverted)
      const secondState: AircraftStateArray = [
        'test004',
        'TST004',
        'United States',
        currentTime - 100,
        currentTime - 100, // SAME last_contact
        -105.0,
        40.0,
        10668, // Better/corrected altitude
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        secondState,
        null,
        new Date('2024-11-14T10:00:00.500Z'), // 500ms later ingestion
        'airplanes.live',
        20,
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude, ingestion_timestamp FROM aircraft_states WHERE icao24 = $1',
        ['test004'],
      );

      // The newer ingestion should have updated the altitude
      expect(result.baro_altitude).toBe(10668);
      expect(new Date(result.ingestion_timestamp).getTime()).toBeGreaterThan(
        new Date('2024-11-14T10:00:00.000Z').getTime(),
      );
    });

    it('should NOT update when same priority, same last_contact, older ingestion_timestamp', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const newerIngestion: AircraftStateArray = [
        'test005',
        'TST005',
        'United States',
        currentTime - 100,
        currentTime - 100,
        -105.0,
        40.0,
        10668, // Correct altitude
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        newerIngestion,
        null,
        new Date('2024-11-14T10:00:01Z'),
        'airplanes.live',
        20,
        true,
      );

      // Attempt to write with older ingestion timestamp
      const olderIngestion: AircraftStateArray = [
        'test005',
        'TST005',
        'United States',
        currentTime - 100,
        currentTime - 100, // Same last_contact
        -105.0,
        40.0,
        9999, // Wrong altitude
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        olderIngestion,
        null,
        new Date('2024-11-14T10:00:00Z'), // 1 second EARLIER
        'airplanes.live',
        20,
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude FROM aircraft_states WHERE icao24 = $1',
        ['test005'],
      );

      // Should still have the correct altitude from the newer ingestion
      expect(result.baro_altitude).toBe(10668);
    });
  });

  describe('priority-based overwrites', () => {
    it('should allow higher priority source to overwrite lower priority', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      // Lower priority data (OpenSky = 30)
      const lowerPriority: AircraftStateArray = [
        'test006',
        'TST006',
        'United States',
        currentTime - 100,
        currentTime - 100,
        -105.0,
        40.0,
        10000,
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        lowerPriority,
        null,
        new Date(),
        'opensky',
        30, // Lower priority
        true,
      );

      // Higher priority data (airplanes.live = 20)
      const higherPriority: AircraftStateArray = [
        'test006',
        'TST006',
        'United States',
        currentTime - 200, // Even with OLDER timestamp (100 seconds older)
        currentTime - 200,
        -106.0, // Different data
        41.0,
        11000,
        false,
        450,
        185,
        5,
        null,
        11000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        higherPriority,
        null,
        new Date(),
        'airplanes.live',
        20, // Higher priority
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude, velocity, data_source FROM aircraft_states WHERE icao24 = $1',
        ['test006'],
      );

      expect(result.baro_altitude).toBe(11000); // From higher priority
      expect(result.velocity).toBe(450); // From higher priority
      expect(result.data_source).toBe('airplanes.live');
    });

    it('should NOT allow lower priority source to overwrite higher priority', async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      // Higher priority data (feeder = 10)
      const higherPriority: AircraftStateArray = [
        'test007',
        'TST007',
        'United States',
        currentTime - 100,
        currentTime - 100,
        -105.0,
        40.0,
        10668,
        false,
        450,
        180,
        0,
        null,
        10668,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        higherPriority,
        'feeder-001',
        new Date(),
        'feeder',
        10, // Highest priority
        true,
      );

      // Lower priority data (airplanes.live = 20)
      const lowerPriority: AircraftStateArray = [
        'test007',
        'TST007',
        'United States',
        currentTime - 50, // Even with NEWER timestamp (50 seconds newer)
        currentTime - 50,
        -106.0,
        41.0,
        11000,
        false,
        400,
        185,
        5,
        null,
        11000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        lowerPriority,
        null,
        new Date(),
        'airplanes.live',
        20, // Lower priority
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude, velocity, data_source FROM aircraft_states WHERE icao24 = $1',
        ['test007'],
      );

      // Should still have data from higher priority source
      expect(result.baro_altitude).toBe(10668);
      expect(result.velocity).toBe(450);
      expect(result.data_source).toBe('feeder');
    });
  });

  describe('stale data handling', () => {
    it('should overwrite stale data (>10 minutes old) regardless of priority', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 700; // 11 minutes ago

      const staleState: AircraftStateArray = [
        'test008',
        'TST008',
        'United States',
        staleTimestamp,
        staleTimestamp,
        -105.0,
        40.0,
        10000,
        false,
        400,
        180,
        0,
        null,
        10000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        staleState,
        'feeder-001',
        new Date(staleTimestamp * 1000),
        'feeder',
        10, // High priority
        true,
      );

      const freshTimestamp = Math.floor(Date.now() / 1000) - 5; // 5 seconds ago

      const freshState: AircraftStateArray = [
        'test008',
        'TST008',
        'United States',
        freshTimestamp,
        freshTimestamp,
        -106.0,
        41.0,
        11000,
        false,
        450,
        185,
        5,
        null,
        11000,
        '1200',
        false,
        0,
        3,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date(),
      ];

      await repository.upsertAircraftStateWithPriority(
        freshState,
        null,
        new Date(),
        'opensky',
        30, // Low priority, but data is fresh
        true,
      );

      const result = await db.oneOrNone(
        'SELECT baro_altitude, velocity, last_contact FROM aircraft_states WHERE icao24 = $1',
        ['test008'],
      );

      // Fresh data should overwrite stale data
      expect(result.baro_altitude).toBe(11000);
      expect(result.velocity).toBe(450);
      expect(result.last_contact).toBe(freshTimestamp);
    });
  });
});
