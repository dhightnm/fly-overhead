import { getConnection } from '../DatabaseConnection';
import AircraftRepository from '../AircraftRepository';
import SchemaRepository from '../SchemaRepository';

type AircraftStateArray = any[];

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('AircraftRepository - Integration Tests', () => {
  let aircraftRepo: AircraftRepository;
  let schemaRepo: SchemaRepository;
  let db: any;

  beforeAll(async () => {
    const connection = getConnection();
    db = connection.getDb();
    const postgis = connection.getPostGIS();
    aircraftRepo = new AircraftRepository(db, postgis);
    schemaRepo = new SchemaRepository();

    // Ensure tables exist
    await schemaRepo.createMainTable();
    await schemaRepo.createHistoryTable();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await db.query('DELETE FROM aircraft_states WHERE icao24 LIKE $1', ['test_%']);
    await db.query('DELETE FROM aircraft_states_history WHERE icao24 LIKE $1', ['test_%']);
  });

  afterAll(async () => {
    // Clean up test data
    await db.query('DELETE FROM aircraft_states WHERE icao24 LIKE $1', ['test_%']);
    await db.query('DELETE FROM aircraft_states_history WHERE icao24 LIKE $1', ['test_%']);
  });

  describe('Altitude Conversion - Database Storage', () => {
    /**
     * These tests verify that altitude values are stored in METERS in the database,
     * preventing the bug where unconverted feet values caused 100k+ ft displays
     */

    it('should store altitude in METERS in the database', async () => {
      const state: AircraftStateArray = [
        'test_alt_001', // 0: icao24
        'TEST001', // 1: callsign
        'United States', // 2: origin_country
        1763154000, // 3: time_position
        1763154000, // 4: last_contact
        -105.0, // 5: longitude
        40.0, // 6: latitude
        10668, // 7: baro_altitude in METERS (35000 ft converted)
        false, // 8: on_ground
        450, // 9: velocity in knots
        180, // 10: true_track
        0, // 11: vertical_rate
        null, // 12: sensors
        10668, // 13: geo_altitude in METERS
        null, // 14: squawk
        false, // 15: spi
        0, // 16: position_source
        3, // 17: category
        new Date(), // 18: created_at
        'B738', // 19: aircraft_type
        'BOEING 737-800', // 20: aircraft_description
        'N12345', // 21: registration
        null, // 22: emergency_status
        1013.2, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        true // skipHistory
      );

      // Verify stored value
      const result = await db.one(
        'SELECT baro_altitude, geo_altitude FROM aircraft_states WHERE icao24 = $1',
        ['test_alt_001']
      );

      expect(result.baro_altitude).toBeCloseTo(10668, 1); // Stored in meters
      expect(result.baro_altitude).not.toBe(35000); // NOT in feet
    });

    it('should handle high-altitude aircraft correctly', async () => {
      const state: AircraftStateArray = [
        'test_alt_002', // 0: icao24
        'BIZ001', // 1: callsign
        'United States', // 2: origin_country
        1763154000, // 3: time_position
        1763154000, // 4: last_contact
        -105.0, // 5: longitude
        40.0, // 6: latitude
        18288, // 7: baro_altitude (60000 ft in meters)
        false, // 8: on_ground
        500, // 9: velocity
        180, // 10: true_track
        0, // 11: vertical_rate
        null, // 12: sensors
        18288, // 13: geo_altitude
        null, // 14: squawk
        false, // 15: spi
        0, // 16: position_source
        3, // 17: category
        new Date(), // 18: created_at
        'GLF6', // 19: aircraft_type
        'GULFSTREAM G650', // 20: aircraft_description
        'N54321', // 21: registration
        null, // 22: emergency_status
        1013.2, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        true
      );

      const result = await db.one(
        'SELECT baro_altitude FROM aircraft_states WHERE icao24 = $1',
        ['test_alt_002']
      );

      expect(result.baro_altitude).toBeCloseTo(18288, 1);
      // Ensure it's stored as meters, not feet
      expect(result.baro_altitude).toBeLessThan(60000);
    });
  });

  describe('Upsert Priority Logic - Same Timestamp Race Condition', () => {
    /**
     * These tests verify the fix for the race condition where unconverted data
     * could overwrite converted data when timestamps were identical.
     */

    it('should allow fresher data to overwrite when last_contact is same but ingestion_timestamp is newer', async () => {
      const lastContact = 1763154000;
      const icao24 = 'test_race_001';

      // First insert: unconverted altitude (simulating old bug)
      const oldState: AircraftStateArray = [
        icao24,
        'TEST001',
        'United States',
        lastContact,
        lastContact,
        -105.0,
        40.0,
        35000, // WRONG: stored in feet (old bug)
        false,
        450,
        180,
        0,
        null,
        35000,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      const oldTimestamp = new Date('2025-11-14T20:00:00Z');
      await aircraftRepo.upsertAircraftStateWithPriority(
        oldState,
        null,
        oldTimestamp,
        'airplanes.live',
        20,
        true
      );

      // Wait a moment to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second insert: converted altitude (correct)
      const newState: AircraftStateArray = [
        icao24,
        'TEST001',
        'United States',
        lastContact, // Same last_contact
        lastContact,
        -105.0,
        40.0,
        10668, // CORRECT: stored in meters
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      const newTimestamp = new Date('2025-11-14T20:00:05Z'); // 5 seconds later
      await aircraftRepo.upsertAircraftStateWithPriority(
        newState,
        null,
        newTimestamp,
        'airplanes.live',
        20,
        true
      );

      // Verify the converted value won
      const result = await db.one(
        'SELECT baro_altitude, ingestion_timestamp FROM aircraft_states WHERE icao24 = $1',
        [icao24]
      );

      expect(result.baro_altitude).toBeCloseTo(10668, 1); // Should be meters, not feet
      expect(result.baro_altitude).not.toBe(35000); // Old unconverted value should be overwritten
    });

    it('should NOT allow older data to overwrite newer data even with newer ingestion_timestamp', async () => {
      const icao24 = 'test_race_002';

      // First insert: fresh data
      const freshState: AircraftStateArray = [
        icao24,
        'TEST002',
        'United States',
        1763154100, // Newer last_contact
        1763154100,
        -105.0,
        40.0,
        10668, // Correct altitude in meters
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        freshState,
        null,
        new Date('2025-11-14T20:00:00Z'),
        'airplanes.live',
        20,
        true
      );

      // Second insert: stale data (older last_contact but newer ingestion_timestamp)
      const staleState: AircraftStateArray = [
        icao24,
        'TEST002',
        'United States',
        1763154000, // Older last_contact (100 seconds earlier)
        1763154000,
        -105.0,
        40.0,
        9144, // Different altitude
        false,
        420,
        180,
        0,
        null,
        9144,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        staleState,
        null,
        new Date('2025-11-14T20:01:00Z'), // Newer ingestion time
        'airplanes.live',
        20,
        true
      );

      // Verify the fresh data was NOT overwritten by stale data
      const result = await db.one(
        'SELECT baro_altitude, last_contact FROM aircraft_states WHERE icao24 = $1',
        [icao24]
      );

      expect(result.baro_altitude).toBeCloseTo(10668, 1); // Original value preserved
      expect(result.last_contact).toBe(1763154100); // Fresher last_contact preserved
    });

    it('should allow higher priority source to overwrite lower priority', async () => {
      const icao24 = 'test_priority_001';
      const lastContact = 1763154000;

      // First insert: lower priority (airplanes.live = 20)
      const lowPriorityState: AircraftStateArray = [
        icao24,
        'TEST003',
        'United States',
        lastContact,
        lastContact,
        -105.0,
        40.0,
        10668,
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        lowPriorityState,
        null,
        new Date(),
        'airplanes.live',
        20,
        true
      );

      // Second insert: higher priority (feeder = 10)
      const highPriorityState: AircraftStateArray = [
        icao24,
        'TEST003',
        'United States',
        lastContact, // Same timestamp
        lastContact,
        -105.1, // Slightly different position
        40.1,
        10700, // Different altitude
        false,
        455,
        181,
        0,
        null,
        10700,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        highPriorityState,
        'feeder-001',
        new Date(),
        'feeder',
        10, // Higher priority (lower number)
        true
      );

      // Verify higher priority data won
      const result = await db.one(
        'SELECT baro_altitude, longitude, latitude, source_priority FROM aircraft_states WHERE icao24 = $1',
        [icao24]
      );

      expect(result.baro_altitude).toBeCloseTo(10700, 1);
      expect(result.longitude).toBeCloseTo(-105.1, 2);
      expect(result.source_priority).toBe(10);
    });

    it('should update stale data even from lower priority source', async () => {
      const icao24 = 'test_stale_001';

      // First insert: data that becomes stale (>10 minutes old)
      const oldState: AircraftStateArray = [
        icao24,
        'STALE001',
        'United States',
        1763153400, // 10+ minutes ago
        1763153400,
        -105.0,
        40.0,
        10668,
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        oldState,
        'feeder-001',
        new Date('2025-11-14T19:50:00Z'),
        'feeder',
        10, // High priority
        true
      );

      // Second insert: fresh data from lower priority source
      const freshState: AircraftStateArray = [
        icao24,
        'STALE001',
        'United States',
        Math.floor(Date.now() / 1000), // Current time
        Math.floor(Date.now() / 1000),
        -105.1,
        40.1,
        10700,
        false,
        455,
        181,
        0,
        null,
        10700,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        freshState,
        null,
        new Date(),
        'airplanes.live',
        20, // Lower priority
        true
      );

      // Verify fresh data from lower priority source overwrote stale high-priority data
      const result = await db.one(
        'SELECT baro_altitude, longitude FROM aircraft_states WHERE icao24 = $1',
        [icao24]
      );

      expect(result.baro_altitude).toBeCloseTo(10700, 1);
      expect(result.longitude).toBeCloseTo(-105.1, 2);
    });
  });

  describe('Velocity Storage - No Double Conversion', () => {
    it('should store velocity in knots (no conversion)', async () => {
      const state: AircraftStateArray = [
        'test_vel_001',
        'TEST004',
        'United States',
        1763154000,
        1763154000,
        -105.0,
        40.0,
        10668,
        false,
        450, // Velocity in knots
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        true
      );

      const result = await db.one(
        'SELECT velocity FROM aircraft_states WHERE icao24 = $1',
        ['test_vel_001']
      );

      expect(result.velocity).toBe(450); // Stored as-is in knots
    });
  });

  describe('History Table - skipHistory Flag', () => {
    it('should NOT write to history when skipHistory=true', async () => {
      const state: AircraftStateArray = [
        'test_hist_001',
        'TEST005',
        'United States',
        1763154000,
        1763154000,
        -105.0,
        40.0,
        10668,
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        true // skipHistory = true
      );

      // Verify main table has data
      const mainResult = await db.oneOrNone(
        'SELECT icao24 FROM aircraft_states WHERE icao24 = $1',
        ['test_hist_001']
      );
      expect(mainResult).not.toBeNull();

      // Verify history table does NOT have data
      const historyResult = await db.oneOrNone(
        'SELECT icao24 FROM aircraft_states_history WHERE icao24 = $1',
        ['test_hist_001']
      );
      expect(historyResult).toBeNull();
    });

    it('should write to history when skipHistory=false', async () => {
      const state: AircraftStateArray = [
        'test_hist_002',
        'TEST006',
        'United States',
        1763154000,
        1763154000,
        -105.0,
        40.0,
        10668,
        false,
        450,
        180,
        0,
        null,
        10668,
        null,
        false,
        0,
        3,
        new Date(), // 18: created_at
        null, // 19: aircraft_type
        null, // 20: aircraft_description
        null, // 21: registration
        null, // 22: emergency_status
        null, // 23: nav_qnh
        null, // 24: nav_altitude_mcp
        null, // 25: nav_heading
        null, // 26: owner_operator
        null, // 27: year_built
      ];

      await aircraftRepo.upsertAircraftStateWithPriority(
        state,
        null,
        new Date(),
        'airplanes.live',
        20,
        false // skipHistory = false
      );

      // Verify both tables have data
      const mainResult = await db.oneOrNone(
        'SELECT icao24 FROM aircraft_states WHERE icao24 = $1',
        ['test_hist_002']
      );
      expect(mainResult).not.toBeNull();

      const historyResult = await db.oneOrNone(
        'SELECT icao24 FROM aircraft_states_history WHERE icao24 = $1',
        ['test_hist_002']
      );
      expect(historyResult).not.toBeNull();
    });
  });
});

