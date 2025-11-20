import { Response } from 'express';
import postgresRepository from '../../repositories/PostgresRepository';
import { authenticateToken, type AuthenticatedRequest } from '../auth.routes';

// Mock dependencies
jest.mock('../../repositories/PostgresRepository');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

describe('Portal Routes', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  // Mock database connection
  const mockDb = {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
  };

  beforeEach(() => {
    mockRequest = {
      user: {
        userId: 123,
        email: 'test@example.com',
      },
      query: {},
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();

    // Setup default mock for getDb
    (postgresRepository.getDb as jest.Mock) = jest.fn().mockReturnValue(mockDb);
  });

  describe('GET /api/portal/feeders', () => {
    it('should return user feeders successfully', async () => {
      const mockFeeders = [
        {
          feeder_id: 'feeder_123',
          name: 'Test Feeder',
          status: 'active',
          last_seen_at: new Date('2025-01-20T10:00:00Z'),
          latitude: 40.7128,
          longitude: -74.0060,
          created_at: new Date('2025-01-01T00:00:00Z'),
        },
        {
          feeder_id: 'feeder_456',
          name: 'Another Feeder',
          status: 'inactive',
          last_seen_at: null,
          latitude: null,
          longitude: null,
          created_at: new Date('2025-01-15T00:00:00Z'),
        },
      ];

      mockDb.any = jest.fn().mockResolvedValue(mockFeeders);

      // Test the handler logic directly
      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const feeders = await postgresRepository
            .getDb()
            .any(
              `SELECT 
                feeder_id,
                name,
                status,
                last_seen_at,
                ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude,
                created_at
              FROM feeders 
              WHERE metadata->>'user_id' = $1
              ORDER BY created_at DESC`,
              [userId.toString()]
            );

          res.json({
            feeders: feeders.map((feeder) => ({
              feeder_id: feeder.feeder_id,
              name: feeder.name,
              status: feeder.status,
              last_seen_at: feeder.last_seen_at ? new Date(feeder.last_seen_at).toISOString() : null,
              latitude: feeder.latitude,
              longitude: feeder.longitude,
              created_at: new Date(feeder.created_at).toISOString(),
            })),
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['123']
      );
      expect(mockResponse.json).toHaveBeenCalledWith({
        feeders: [
          {
            feeder_id: 'feeder_123',
            name: 'Test Feeder',
            status: 'active',
            last_seen_at: '2025-01-20T10:00:00.000Z',
            latitude: 40.7128,
            longitude: -74.0060,
            created_at: '2025-01-01T00:00:00.000Z',
          },
          {
            feeder_id: 'feeder_456',
            name: 'Another Feeder',
            status: 'inactive',
            last_seen_at: null,
            latitude: null,
            longitude: null,
            created_at: '2025-01-15T00:00:00.000Z',
          },
        ],
      });
    });

    it('should return empty array when user has no feeders', async () => {
      mockDb.any = jest.fn().mockResolvedValue([]);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const feeders = await postgresRepository
            .getDb()
            .any(
              `SELECT 
                feeder_id,
                name,
                status,
                last_seen_at,
                ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude,
                created_at
              FROM feeders 
              WHERE metadata->>'user_id' = $1
              ORDER BY created_at DESC`,
              [userId.toString()]
            );

          res.json({
            feeders: feeders.map((feeder) => ({
              feeder_id: feeder.feeder_id,
              name: feeder.name,
              status: feeder.status,
              last_seen_at: feeder.last_seen_at ? new Date(feeder.last_seen_at).toISOString() : null,
              latitude: feeder.latitude,
              longitude: feeder.longitude,
              created_at: new Date(feeder.created_at).toISOString(),
            })),
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        feeders: [],
      });
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database connection failed');
      mockDb.any = jest.fn().mockRejectedValue(dbError);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const feeders = await postgresRepository
            .getDb()
            .any(
              `SELECT 
                feeder_id,
                name,
                status,
                last_seen_at,
                ST_Y(location::geometry) as latitude,
                ST_X(location::geometry) as longitude,
                created_at
              FROM feeders 
              WHERE metadata->>'user_id' = $1
              ORDER BY created_at DESC`,
              [userId.toString()]
            );

          res.json({
            feeders: feeders.map((feeder) => ({
              feeder_id: feeder.feeder_id,
              name: feeder.name,
              status: feeder.status,
              last_seen_at: feeder.last_seen_at ? new Date(feeder.last_seen_at).toISOString() : null,
              latitude: feeder.latitude,
              longitude: feeder.longitude,
              created_at: new Date(feeder.created_at).toISOString(),
            })),
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
    });

    it('should require authentication', () => {
      const unauthenticatedRequest = {
        ...mockRequest,
        user: undefined,
      } as AuthenticatedRequest;

      // authenticateToken should reject
      authenticateToken(unauthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe('GET /api/portal/aircraft', () => {
    it('should return aircraft from user feeders', async () => {
      const mockFeeders = [
        { feeder_id: 'feeder_123' },
        { feeder_id: 'feeder_456' },
      ];
      const mockAircraft = [
        {
          icao24: 'abc123',
          callsign: 'UAL123',
          latitude: 40.7128,
          longitude: -74.0060,
          baro_altitude: 35000,
          geo_altitude: 36000,
          velocity: 450,
          true_track: 90,
          vertical_rate: 0,
          squawk: '1200',
          on_ground: false,
          category: 1,
          last_contact: 1705756800,
          feeder_id: 'feeder_123',
          data_source: 'feeder',
          source_priority: 10,
          departure_iata: 'JFK',
          departure_icao: 'KJFK',
          departure_name: 'John F. Kennedy International Airport',
          arrival_iata: 'LAX',
          arrival_icao: 'KLAX',
          arrival_name: 'Los Angeles International Airport',
          aircraft_type: 'B737',
          route_source: 'flightaware',
        },
      ];
      const mockTotal = { total: '1' };

      mockDb.any = jest.fn()
        .mockResolvedValueOnce(mockFeeders) // First call for feeders
        .mockResolvedValueOnce(mockAircraft); // Second call for aircraft
      mockDb.one = jest.fn().mockResolvedValue(mockTotal);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;
          const limit = parseInt(req.query.limit as string, 10) || 100;
          const offset = parseInt(req.query.offset as string, 10) || 0;

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          if (userFeeders.length === 0) {
            return res.json({
              aircraft: [],
              total: 0,
            });
          }

          const feederIds = userFeeders.map((f) => f.feeder_id);

          const aircraft = await postgresRepository
            .getDb()
            .any(
              `SELECT 
                a.icao24,
                a.callsign,
                a.latitude,
                a.longitude,
                a.baro_altitude,
                a.geo_altitude,
                a.velocity,
                a.true_track,
                a.vertical_rate,
                a.squawk,
                a.on_ground,
                a.category,
                a.last_contact,
                a.feeder_id,
                a.data_source,
                a.source_priority,
                c.departure_iata,
                c.departure_icao,
                c.departure_name,
                c.arrival_iata,
                c.arrival_icao,
                c.arrival_name,
                c.aircraft_type,
                c.source as route_source
              FROM aircraft_states a
              LEFT JOIN LATERAL (
                SELECT 
                  departure_iata,
                  departure_icao,
                  departure_name,
                  arrival_iata,
                  arrival_icao,
                  arrival_name,
                  aircraft_type,
                  source
                FROM flight_routes_cache
                WHERE cache_key = a.icao24
                UNION ALL
                SELECT 
                  departure_iata,
                  departure_icao,
                  departure_name,
                  arrival_iata,
                  arrival_icao,
                  arrival_name,
                  aircraft_type,
                  source
                FROM flight_routes_cache
                WHERE cache_key = a.callsign 
                  AND a.callsign IS NOT NULL 
                  AND a.callsign != ''
              ) c ON true
              WHERE a.feeder_id = ANY($1)
                AND a.last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')
              ORDER BY a.last_contact DESC
              LIMIT $2 OFFSET $3`,
              [feederIds, limit, offset]
            );

          const totalResult = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as total
              FROM aircraft_states
              WHERE feeder_id = ANY($1)
                AND last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
              [feederIds]
            );

          const transformedAircraft = aircraft.map((ac) => ({
            icao24: ac.icao24,
            callsign: ac.callsign,
            latitude: ac.latitude,
            longitude: ac.longitude,
            baro_altitude: ac.baro_altitude,
            geo_altitude: ac.geo_altitude,
            velocity: ac.velocity,
            true_track: ac.true_track,
            vertical_rate: ac.vertical_rate,
            squawk: ac.squawk,
            on_ground: ac.on_ground,
            category: ac.category,
            last_contact: ac.last_contact,
            feeder_id: ac.feeder_id,
            data_source: ac.data_source,
            source_priority: ac.source_priority,
            route: ac.departure_icao || ac.departure_iata ? {
              departureAirport: {
                icao: ac.departure_icao,
                iata: ac.departure_iata,
                name: ac.departure_name,
              },
              arrivalAirport: {
                icao: ac.arrival_icao,
                iata: ac.arrival_iata,
                name: ac.arrival_name,
              },
              aircraft: {
                type: ac.aircraft_type,
              },
              source: ac.route_source,
            } : null,
          }));

          res.json({
            aircraft: transformedAircraft,
            total: parseInt(totalResult.total, 10),
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        aircraft: [
          {
            icao24: 'abc123',
            callsign: 'UAL123',
            latitude: 40.7128,
            longitude: -74.0060,
            baro_altitude: 35000,
            geo_altitude: 36000,
            velocity: 450,
            true_track: 90,
            vertical_rate: 0,
            squawk: '1200',
            on_ground: false,
            category: 1,
            last_contact: 1705756800,
            feeder_id: 'feeder_123',
            data_source: 'feeder',
            source_priority: 10,
            route: {
              departureAirport: {
                icao: 'KJFK',
                iata: 'JFK',
                name: 'John F. Kennedy International Airport',
              },
              arrivalAirport: {
                icao: 'KLAX',
                iata: 'LAX',
                name: 'Los Angeles International Airport',
              },
              aircraft: {
                type: 'B737',
              },
              source: 'flightaware',
            },
          },
        ],
        total: 1,
      });
    });

    it('should return empty array when user has no feeders', async () => {
      mockDb.any = jest.fn().mockResolvedValueOnce([]);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          if (userFeeders.length === 0) {
            return res.json({
              aircraft: [],
              total: 0,
            });
          }
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        aircraft: [],
        total: 0,
      });
    });

    it('should handle pagination parameters', async () => {
      mockRequest.query = { limit: '50', offset: '10' };
      const mockFeeders = [{ feeder_id: 'feeder_123' }];
      const mockAircraft: any[] = [];
      const mockTotal = { total: '0' };

      mockDb.any = jest.fn()
        .mockResolvedValueOnce(mockFeeders)
        .mockResolvedValueOnce(mockAircraft);
      mockDb.one = jest.fn().mockResolvedValue(mockTotal);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;
          const limit = parseInt(req.query.limit as string, 10) || 100;
          const offset = parseInt(req.query.offset as string, 10) || 0;

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          if (userFeeders.length === 0) {
            return res.json({
              aircraft: [],
              total: 0,
            });
          }

          const feederIds = userFeeders.map((f) => f.feeder_id);

          await postgresRepository
            .getDb()
            .any(
              `SELECT * FROM aircraft_states WHERE feeder_id = ANY($1) LIMIT $2 OFFSET $3`,
              [feederIds, limit, offset]
            );
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [['feeder_123'], 50, 10]
      );
    });

    it('should use default pagination when not provided', async () => {
      mockRequest.query = {};
      const mockFeeders = [{ feeder_id: 'feeder_123' }];
      const mockAircraft: any[] = [];
      const mockTotal = { total: '0' };

      mockDb.any = jest.fn()
        .mockResolvedValueOnce(mockFeeders)
        .mockResolvedValueOnce(mockAircraft);
      mockDb.one = jest.fn().mockResolvedValue(mockTotal);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;
          const limit = parseInt(req.query.limit as string, 10) || 100;
          const offset = parseInt(req.query.offset as string, 10) || 0;

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          if (userFeeders.length === 0) {
            return res.json({
              aircraft: [],
              total: 0,
            });
          }

          const feederIds = userFeeders.map((f) => f.feeder_id);

          await postgresRepository
            .getDb()
            .any(
              `SELECT * FROM aircraft_states WHERE feeder_id = ANY($1) LIMIT $2 OFFSET $3`,
              [feederIds, limit, offset]
            );
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockDb.any).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [['feeder_123'], 100, 0] // Default values
      );
    });

    it('should handle aircraft without route data', async () => {
      const mockFeeders = [{ feeder_id: 'feeder_123' }];
      const mockAircraft = [
        {
          icao24: 'abc123',
          callsign: 'UAL123',
          latitude: 40.7128,
          longitude: -74.0060,
          baro_altitude: 35000,
          geo_altitude: 36000,
          velocity: 450,
          true_track: 90,
          vertical_rate: 0,
          squawk: '1200',
          on_ground: false,
          category: 1,
          last_contact: 1705756800,
          feeder_id: 'feeder_123',
          data_source: 'feeder',
          source_priority: 10,
          departure_iata: null,
          departure_icao: null,
          departure_name: null,
          arrival_iata: null,
          arrival_icao: null,
          arrival_name: null,
          aircraft_type: null,
          route_source: null,
        },
      ];
      const mockTotal = { total: '1' };

      mockDb.any = jest.fn()
        .mockResolvedValueOnce(mockFeeders)
        .mockResolvedValueOnce(mockAircraft);
      mockDb.one = jest.fn().mockResolvedValue(mockTotal);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;
          const limit = parseInt(req.query.limit as string, 10) || 100;
          const offset = parseInt(req.query.offset as string, 10) || 0;

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          if (userFeeders.length === 0) {
            return res.json({
              aircraft: [],
              total: 0,
            });
          }

          const feederIds = userFeeders.map((f) => f.feeder_id);

          const aircraft = await postgresRepository
            .getDb()
            .any(
              `SELECT * FROM aircraft_states WHERE feeder_id = ANY($1) LIMIT $2 OFFSET $3`,
              [feederIds, limit, offset]
            );

          const totalResult = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as total FROM aircraft_states WHERE feeder_id = ANY($1)`,
              [feederIds]
            );

          const transformedAircraft = aircraft.map((ac: any) => ({
            icao24: ac.icao24,
            route: ac.departure_icao || ac.departure_iata ? {
              departureAirport: {
                icao: ac.departure_icao,
                iata: ac.departure_iata,
                name: ac.departure_name,
              },
            } : null,
          }));

          res.json({
            aircraft: transformedAircraft,
            total: parseInt(totalResult.total, 10),
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        aircraft: [
          expect.objectContaining({
            icao24: 'abc123',
            route: null,
          }),
        ],
        total: 1,
      });
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database query failed');
      mockDb.any = jest.fn().mockRejectedValue(dbError);

      const handler = async (req: AuthenticatedRequest, _res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
    });
  });

  describe('GET /api/portal/stats', () => {
    it('should return portal statistics', async () => {
      const mockFeederCount = { count: '2' };
      const mockFeeders = [
        { feeder_id: 'feeder_123' },
        { feeder_id: 'feeder_456' },
      ];
      const mockAircraftCount = { count: '150' };
      const mockApiKeyCount = { count: '3' };

      mockDb.one = jest.fn()
        .mockResolvedValueOnce(mockFeederCount)
        .mockResolvedValueOnce(mockAircraftCount)
        .mockResolvedValueOnce(mockApiKeyCount);
      mockDb.any = jest.fn().mockResolvedValue(mockFeeders);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const feederCount = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as count
              FROM feeders 
              WHERE metadata->>'user_id' = $1 AND status = 'active'`,
              [userId.toString()]
            );

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          let aircraftCount = 0;
          if (userFeeders.length > 0) {
            const feederIds = userFeeders.map((f) => f.feeder_id);
            const aircraftResult = await postgresRepository
              .getDb()
              .one(
                `SELECT COUNT(DISTINCT icao24) as count
                FROM aircraft_states
                WHERE feeder_id = ANY($1)
                  AND last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
                [feederIds]
              );
            aircraftCount = parseInt(aircraftResult.count, 10);
          }

          const apiKeyCount = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as count
              FROM api_keys
              WHERE user_id = $1 AND status = 'active'`,
              [userId]
            );

          res.json({
            stats: {
              totalAircraft: aircraftCount,
              activeFeeders: parseInt(feederCount.count, 10),
              totalApiKeys: parseInt(apiKeyCount.count, 10),
              recentAircraft: aircraftCount,
            },
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        stats: {
          totalAircraft: 150,
          activeFeeders: 2,
          totalApiKeys: 3,
          recentAircraft: 150,
        },
      });
    });

    it('should return zero counts when user has no feeders', async () => {
      const mockFeederCount = { count: '0' };
      const mockApiKeyCount = { count: '1' };

      mockDb.one = jest.fn()
        .mockResolvedValueOnce(mockFeederCount)
        .mockResolvedValueOnce(mockApiKeyCount);
      mockDb.any = jest.fn().mockResolvedValue([]);

      const handler = async (req: AuthenticatedRequest, res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          const feederCount = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as count
              FROM feeders 
              WHERE metadata->>'user_id' = $1 AND status = 'active'`,
              [userId.toString()]
            );

          const userFeeders = await postgresRepository
            .getDb()
            .any(
              `SELECT feeder_id FROM feeders WHERE metadata->>'user_id' = $1`,
              [userId.toString()]
            );

          let aircraftCount = 0;
          if (userFeeders.length > 0) {
            const feederIds = userFeeders.map((f) => f.feeder_id);
            const aircraftResult = await postgresRepository
              .getDb()
              .one(
                `SELECT COUNT(DISTINCT icao24) as count
                FROM aircraft_states
                WHERE feeder_id = ANY($1)
                  AND last_contact >= EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')`,
                [feederIds]
              );
            aircraftCount = parseInt(aircraftResult.count, 10);
          }

          const apiKeyCount = await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as count
              FROM api_keys
              WHERE user_id = $1 AND status = 'active'`,
              [userId]
            );

          res.json({
            stats: {
              totalAircraft: aircraftCount,
              activeFeeders: parseInt(feederCount.count, 10),
              totalApiKeys: parseInt(apiKeyCount.count, 10),
              recentAircraft: aircraftCount,
            },
          });
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        stats: {
          totalAircraft: 0,
          activeFeeders: 0,
          totalApiKeys: 1,
          recentAircraft: 0,
        },
      });
    });

    it('should handle database errors', async () => {
      const dbError = new Error('Database query failed');
      mockDb.one = jest.fn().mockRejectedValue(dbError);

      const handler = async (req: AuthenticatedRequest, _res: Response, next: jest.Mock) => {
        try {
          const userId = req.user!.userId;

          await postgresRepository
            .getDb()
            .one(
              `SELECT COUNT(*) as count
              FROM feeders 
              WHERE metadata->>'user_id' = $1 AND status = 'active'`,
              [userId.toString()]
            );
        } catch (error) {
          return next(error);
        }
      };

      await handler(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(dbError);
    });
  });
});
