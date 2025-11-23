import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import webSocketService from './WebSocketService';

/**
 * RealTimeEventService
 * Subscribes to Redis pub/sub for aircraft position updates and broadcasts to WebSocket clients
 * This bridges webhook events to real-time frontend updates
 */
class RealTimeEventService {
  private redisSub: Redis | null = null;

  private readonly pubSubChannel = 'flyoverhead:events';

  private isSubscribed: boolean = false;

  private aircraftUpdateBuffer: Map<string, any> = new Map();

  private bufferFlushInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize and start subscribing to Redis pub/sub
   */
  async start(): Promise<void> {
    if (!config.webhooks.enabled) {
      logger.info('RealTimeEventService disabled (webhooks disabled)');
      return;
    }

    try {
      this.redisSub = new Redis(config.webhooks.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redisSub.on('connect', () => {
        logger.info('RealTimeEventService connected to Redis', { channel: this.pubSubChannel });
      });

      this.redisSub.on('error', (error) => {
        logger.error('RealTimeEventService Redis error', { error: error.message });
      });

      await this.redisSub.connect();

      // Subscribe to events channel
      await this.redisSub.subscribe(this.pubSubChannel);
      this.isSubscribed = true;

      // Listen for messages
      this.redisSub.on('message', (channel, message) => {
        if (channel === this.pubSubChannel) {
          this.handleEvent(message);
        }
      });

      // Start buffer flush interval (batch updates every 500ms)
      this.bufferFlushInterval = setInterval(() => {
        this.flushAircraftBuffer();
      }, 500);

      logger.info('RealTimeEventService started and subscribed to events', {
        channel: this.pubSubChannel,
      });
    } catch (error) {
      logger.error('Failed to start RealTimeEventService', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle incoming event from Redis pub/sub
   */
  private handleEvent(message: string): void {
    try {
      const event = JSON.parse(message);
      if (event.eventType === 'aircraft.position.updated' && event.payload) {
        const { payload } = event;
        const icao24 = payload.icao24;

        if (!icao24) {
          return;
        }

        // Buffer aircraft updates to batch them
        this.aircraftUpdateBuffer.set(icao24, {
          ...payload,
          eventId: event.eventId,
          occurredAt: event.occurredAt,
        });
      }
    } catch (error) {
      logger.warn('Failed to parse event from Redis pub/sub', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Flush buffered aircraft updates and broadcast to all WebSocket clients
   * This sends incremental updates to all connected clients regardless of bounds
   * The frontend will filter based on its current viewport
   */
  private flushAircraftBuffer(): void {
    if (this.aircraftUpdateBuffer.size === 0) {
      return;
    }

    const updates = Array.from(this.aircraftUpdateBuffer.values());
    this.aircraftUpdateBuffer.clear();

    // Convert to frontend-friendly format
    const aircraftData = updates.map((update) => ({
      icao24: update.icao24,
      callsign: update.callsign || null,
      latitude: update.position?.latitude || null,
      longitude: update.position?.longitude || null,
      baro_altitude: update.position?.baro_altitude || null,
      geo_altitude: update.position?.geo_altitude || null,
      velocity: update.velocity || null,
      true_track: update.true_track || null,
      vertical_rate: update.vertical_rate || null,
      squawk: update.squawk || null,
      on_ground: update.on_ground || null,
      last_contact: update.last_contact || null,
      data_source: update.source || null,
      source_priority: update.source_priority || null,
      position_source: 'websocket',
      source: 'websocket',
      // Include other fields that might be useful
      registration: update.registration || null,
      aircraft_type: update.aircraft_type || null,
      aircraft_description: update.aircraft_description || null,
    })).filter((ac) => ac.latitude !== null && ac.longitude !== null);

    if (aircraftData.length === 0) {
      return;
    }

    // Broadcast to all connected WebSocket clients
    // The frontend will handle filtering by bounds
    const io = webSocketService.getIO();
    if (io) {
      // Send incremental update to all clients
      // Format matches what frontend expects: { type, data: { updated: [...] } }
      io.emit('aircraft:update', {
        type: 'incremental',
        timestamp: new Date().toISOString(),
        data: {
          updated: aircraftData,
        },
      });

      logger.debug('Broadcasted aircraft updates via WebSocket', {
        count: aircraftData.length,
        clients: io.sockets.sockets.size,
      });
    }
  }

  /**
   * Stop the service and cleanup
   */
  async stop(): Promise<void> {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
      this.bufferFlushInterval = null;
    }

    if (this.redisSub && this.isSubscribed) {
      await this.redisSub.unsubscribe(this.pubSubChannel);
      await this.redisSub.quit();
      this.isSubscribed = false;
    }

    logger.info('RealTimeEventService stopped');
  }
}

const realTimeEventService = new RealTimeEventService();
export default realTimeEventService;

