// Set up mocks before importing the service
const mockRedisInstance = {
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
};

const mockWebSocketIO = {
  emit: jest.fn(),
  sockets: {
    sockets: {
      size: 2,
    },
  },
};

const mockConfig = {
  webhooks: {
    enabled: true,
    redisUrl: 'redis://localhost:6379',
  },
};

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('../../config', () => ({
  __esModule: true,
  default: mockConfig,
}));

jest.mock('../WebSocketService', () => ({
  __esModule: true,
  default: {
    getIO: jest.fn(() => mockWebSocketIO),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Import will be done after mocks in each test to allow resetModules
let realTimeEventService: any;

describe('RealTimeEventService', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    
    // Re-import the service to get a fresh singleton instance
    // eslint-disable-next-line import/first
    realTimeEventService = (await import('../RealTimeEventService')).default;
    
    mockConfig.webhooks.enabled = true;
    mockRedisInstance.subscribe.mockClear();
    mockRedisInstance.unsubscribe.mockClear();
    mockRedisInstance.quit.mockClear();
    mockRedisInstance.on.mockClear();
    mockRedisInstance.connect.mockClear();
    mockWebSocketIO.emit.mockClear();
  });

  afterEach(async () => {
    // Clean up any running service
    try {
      if (realTimeEventService) {
        await realTimeEventService.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('start', () => {

    it('should not start when webhooks are disabled', async () => {
      mockConfig.webhooks.enabled = false;

      await realTimeEventService.start();

      expect(mockRedisInstance.connect).not.toHaveBeenCalled();
      expect(mockRedisInstance.subscribe).not.toHaveBeenCalled();
    });

    it('should connect to Redis and subscribe to events channel', async () => {
      await realTimeEventService.start();

      expect(mockRedisInstance.connect).toHaveBeenCalled();
      expect(mockRedisInstance.subscribe).toHaveBeenCalledWith('flyoverhead:events');
      expect(mockRedisInstance.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('should set up buffer flush interval', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      await realTimeEventService.start();

      // Should have set up interval
      expect(setIntervalSpy).toHaveBeenCalled();
      setIntervalSpy.mockRestore();
    });

    it('should handle Redis connection errors', async () => {
      const connectError = new Error('Connection failed');
      mockRedisInstance.connect.mockRejectedValue(connectError);

      await realTimeEventService.start();

      // Should attempt connection but handle error gracefully
      expect(mockRedisInstance.connect).toHaveBeenCalled();
    });
  });

  describe('handleEvent', () => {
    beforeEach(async () => {
      await realTimeEventService.start();
    });

    it('should buffer aircraft.position.updated events', async () => {
      const message = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          callsign: 'TEST123',
          position: { latitude: 40.0, longitude: -74.0 },
          velocity: 250,
          source: 'feeder',
          source_priority: 10,
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      // Get the message handler
      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      // Manually trigger flush by waiting a bit (in real scenario, interval does this)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should have broadcasted the update
      expect(mockWebSocketIO.emit).toHaveBeenCalledWith(
        'aircraft:update',
        expect.objectContaining({
          type: 'incremental',
          data: {
            updated: expect.arrayContaining([
              expect.objectContaining({
                icao24: 'abc123',
                callsign: 'TEST123',
                latitude: 40.0,
                longitude: -74.0,
                velocity: 250,
                data_source: 'feeder',
                source_priority: 10,
                position_source: 'websocket',
                source: 'websocket',
              }),
            ]),
          },
        }),
      );
    });

    it('should ignore events without icao24', async () => {
      const message = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          // Missing icao24
          callsign: 'TEST123',
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should not broadcast (no valid aircraft data)
      expect(mockWebSocketIO.emit).not.toHaveBeenCalled();
    });

    it('should ignore non-aircraft events', async () => {
      const message = JSON.stringify({
        eventType: 'webhook.test',
        eventId: 'event-1',
        payload: { test: true },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should not broadcast non-aircraft events
      expect(mockWebSocketIO.emit).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', async () => {
      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', 'invalid json{');
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should not crash, should not broadcast
      expect(mockWebSocketIO.emit).not.toHaveBeenCalled();
    });

    it('should deduplicate updates by icao24 (latest wins)', async () => {
      const message1 = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          position: { latitude: 40.0, longitude: -74.0 },
          velocity: 250,
        },
        occurredAt: new Date('2024-01-01T12:00:00Z').toISOString(),
        version: 'v1',
      });

      const message2 = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-2',
        payload: {
          icao24: 'abc123', // Same aircraft
          position: { latitude: 40.1, longitude: -74.1 }, // Updated position
          velocity: 260, // Updated velocity
        },
        occurredAt: new Date('2024-01-01T12:00:01Z').toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message1);
        messageHandler('flyoverhead:events', message2);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should only broadcast once with latest data
      expect(mockWebSocketIO.emit).toHaveBeenCalledTimes(1);
      const broadcast = mockWebSocketIO.emit.mock.calls[0][1];
      expect(broadcast.data.updated).toHaveLength(1);
      expect(broadcast.data.updated[0].latitude).toBe(40.1); // Latest position
      expect(broadcast.data.updated[0].velocity).toBe(260); // Latest velocity
    });

    it('should filter out aircraft without valid positions', async () => {
      const message = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          // Missing position
          velocity: 250,
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should not broadcast (no valid position)
      expect(mockWebSocketIO.emit).not.toHaveBeenCalled();
    });
  });

  describe('flushAircraftBuffer', () => {
    beforeEach(async () => {
      await realTimeEventService.start();
    });

    it('should batch multiple aircraft updates', async () => {
      const aircraft1 = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          position: { latitude: 40.0, longitude: -74.0 },
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const aircraft2 = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-2',
        payload: {
          icao24: 'def456',
          position: { latitude: 41.0, longitude: -75.0 },
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', aircraft1);
        messageHandler('flyoverhead:events', aircraft2);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should broadcast both aircraft in one message
      expect(mockWebSocketIO.emit).toHaveBeenCalledTimes(1);
      const broadcast = mockWebSocketIO.emit.mock.calls[0][1];
      expect(broadcast.data.updated).toHaveLength(2);
      expect(broadcast.data.updated.map((a: any) => a.icao24)).toEqual(['abc123', 'def456']);
    });

    it('should not broadcast when buffer is empty', async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Should not broadcast if no events received
      expect(mockWebSocketIO.emit).not.toHaveBeenCalled();
    });

    it('should clear buffer after flushing', async () => {
      const message = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          position: { latitude: 40.0, longitude: -74.0 },
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      // First flush
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(mockWebSocketIO.emit).toHaveBeenCalledTimes(1);

      // Second flush (buffer should be empty)
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(mockWebSocketIO.emit).toHaveBeenCalledTimes(1); // Still 1, no new broadcast
    });

    it('should format aircraft data correctly for frontend', async () => {
      const message = JSON.stringify({
        eventType: 'aircraft.position.updated',
        eventId: 'event-1',
        payload: {
          icao24: 'abc123',
          callsign: 'TEST123',
          position: {
            latitude: 40.0,
            longitude: -74.0,
            baro_altitude: 10000,
            geo_altitude: 11000,
          },
          velocity: 250,
          true_track: 180,
          vertical_rate: 500,
          squawk: '1234',
          on_ground: false,
          last_contact: 1000000,
          registration: 'N12345',
          aircraft_type: 'A320',
          aircraft_description: 'Airbus A320',
          source: 'feeder',
          source_priority: 10,
        },
        occurredAt: new Date().toISOString(),
        version: 'v1',
      });

      const messageHandler = mockRedisInstance.on.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      if (messageHandler) {
        messageHandler('flyoverhead:events', message);
      }

      await new Promise((resolve) => setTimeout(resolve, 600));

      const broadcast = mockWebSocketIO.emit.mock.calls[0][1];
      const aircraft = broadcast.data.updated[0];

      expect(aircraft).toMatchObject({
        icao24: 'abc123',
        callsign: 'TEST123',
        latitude: 40.0,
        longitude: -74.0,
        baro_altitude: 10000,
        geo_altitude: 11000,
        velocity: 250,
        true_track: 180,
        vertical_rate: 500,
        squawk: '1234',
        on_ground: null, // false || null evaluates to null
        last_contact: 1000000,
        registration: 'N12345',
        aircraft_type: 'A320',
        aircraft_description: 'Airbus A320',
        data_source: 'feeder',
        source_priority: 10,
        position_source: 'websocket',
        source: 'websocket',
      });
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      await realTimeEventService.start();
    });

    it('should unsubscribe from Redis and cleanup', async () => {
      await realTimeEventService.stop();

      expect(mockRedisInstance.unsubscribe).toHaveBeenCalledWith('flyoverhead:events');
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it('should clear buffer flush interval', async () => {
      jest.spyOn(global, 'clearInterval');

      await realTimeEventService.stop();

      expect(clearInterval).toHaveBeenCalled();
    });
  });
});

