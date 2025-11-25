import crypto from 'crypto';
import Redis from 'ioredis';
import config from '../config';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';
import webhookQueueService, { type WebhookQueueMessage } from './WebhookQueueService';
import { mapStateArrayToRecord } from '../utils/aircraftState';
import type { AircraftStateArray } from '../types/aircraftState.types';
import type { WebhookSubscription } from '../types/database.types';

interface PublishOptions {
  version?: string;
  metadata?: Record<string, any>;
}

interface PublishResult {
  eventId: string;
  deliveriesEnqueued: number;
}

class WebhookService {
  private redisPub: Redis | null = null;

  private readonly pubSubChannel = 'flyoverhead:events';

  constructor() {
    // Initialize Redis pub/sub client for real-time event broadcasting
    if (config.webhooks.enabled) {
      this.redisPub = new Redis(config.webhooks.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.redisPub.on('connect', () => {
        logger.info('WebhookService Redis pub/sub connected', { channel: this.pubSubChannel });
      });

      this.redisPub.on('error', (error) => {
        logger.error('WebhookService Redis pub/sub error', { error: error.message });
      });

      this.redisPub.connect().catch((error) => {
        logger.warn('WebhookService failed to connect Redis pub/sub', { error: error.message });
      });
    }
  }

  async registerSubscription(params: {
    name: string;
    subscriberId: string;
    callbackUrl: string;
    eventTypes: string[];
    signingSecret?: string;
    rateLimitPerMinute?: number;
    deliveryMaxAttempts?: number;
    deliveryBackoffMs?: number;
    metadata?: Record<string, any>;
  }): Promise<WebhookSubscription> {
    const {
      name,
      subscriberId,
      callbackUrl,
      eventTypes,
      signingSecret = crypto.randomBytes(32).toString('hex'),
      rateLimitPerMinute,
      deliveryMaxAttempts,
      deliveryBackoffMs,
      metadata,
    } = params;

    try {
      const parsedUrl = new URL(callbackUrl);
      const isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(parsedUrl.hostname);
      const isSecure = parsedUrl.protocol === 'https:' || isLocalhost;
      if (config.webhooks.enforceHttps && !isSecure) {
        throw new Error('Webhook callback URL must use HTTPS (or localhost for development)');
      }
    } catch (error) {
      logger.warn('Invalid webhook callback URL', { callbackUrl, error: (error as Error).message });
      throw error;
    }

    if (!config.webhooks.enabled) {
      logger.warn('Webhook registration attempted while webhooks are disabled');
    }

    return postgresRepository.createWebhookSubscription({
      name,
      subscriber_id: subscriberId,
      callback_url: callbackUrl,
      event_types: eventTypes,
      signing_secret: signingSecret,
      rate_limit_per_minute: rateLimitPerMinute,
      delivery_max_attempts: deliveryMaxAttempts,
      delivery_backoff_ms: deliveryBackoffMs,
      metadata,
    });
  }

  async listSubscriptions(status?: string): Promise<WebhookSubscription[]> {
    return postgresRepository.listWebhookSubscriptions(status);
  }

  async publishEvent(
    eventType: string,
    payload: Record<string, any>,
    options: PublishOptions = {},
  ): Promise<PublishResult> {
    if (!config.webhooks.enabled) {
      logger.debug('Webhooks disabled; skipping publish', { eventType });
      return { eventId: 'webhooks-disabled', deliveriesEnqueued: 0 };
    }

    const eventId = crypto.randomUUID();
    const occurredAt = new Date();
    const version = options.version || 'v1';
    const payloadWithMetadata = options.metadata ? { ...payload, metadata: options.metadata } : payload;

    const event = await postgresRepository.createWebhookEvent({
      event_id: eventId,
      event_type: eventType,
      payload: payloadWithMetadata,
      occurred_at: occurredAt,
      version,
    });

    // Always publish to Redis pub/sub for real-time WebSocket delivery (even if no webhook subscriptions)
    // This enables real-time frontend updates regardless of webhook subscriptions
    if (this.redisPub && eventType === 'aircraft.position.updated') {
      try {
        await this.redisPub.publish(
          this.pubSubChannel,
          JSON.stringify({
            eventType,
            eventId,
            payload: payloadWithMetadata,
            occurredAt: occurredAt.toISOString(),
            version,
          }),
        );
        logger.debug('Published aircraft position event to Redis pub/sub', { eventId });
      } catch (error) {
        logger.warn('Failed to publish event to Redis pub/sub', {
          error: (error as Error).message,
          eventId,
        });
      }
    }

    const subscriptions = await postgresRepository.findActiveWebhookSubscriptions(eventType);
    if (!subscriptions.length) {
      logger.debug('No active webhook subscriptions for event', { eventType });
      return { eventId, deliveriesEnqueued: 0 };
    }

    const messages: WebhookQueueMessage[] = [];
    for (const subscription of subscriptions) {
      const deliveryId = crypto.randomUUID();
      await postgresRepository.createWebhookDelivery({
        delivery_id: deliveryId,
        event_id: event.event_id,
        subscription_id: subscription.id,
        next_attempt_at: occurredAt,
      });

      messages.push(this.buildQueueMessage(subscription, deliveryId, event));
    }

    await webhookQueueService.enqueue(messages);

    logger.info('Published webhook event', {
      eventType,
      eventId,
      deliveries: messages.length,
    });

    return {
      eventId,
      deliveriesEnqueued: messages.length,
    };
  }

  async publishAircraftPositionUpdate(
    state: AircraftStateArray,
    source: string,
    ingestionTimestamp: Date | null,
    sourcePriority?: number,
  ): Promise<PublishResult> {
    const payload = this.buildAircraftPayload(state, source, ingestionTimestamp, sourcePriority);
    return this.publishEvent('aircraft.position.updated', payload, { version: 'v1' });
  }

  private buildQueueMessage(
    subscription: WebhookSubscription,
    deliveryId: string,
    event: { event_id: string; event_type: string; payload: Record<string, any>; occurred_at: Date; version: string },
  ): WebhookQueueMessage {
    return {
      deliveryId,
      subscriptionId: subscription.id,
      callbackUrl: subscription.callback_url,
      signingSecret: subscription.signing_secret,
      event: {
        id: event.event_id,
        type: event.event_type,
        payload: event.payload,
        occurredAt: event.occurred_at.toISOString(),
        version: event.version,
      },
      attempt: 0,
      maxAttempts: subscription.delivery_max_attempts || config.webhooks.maxAttempts,
      backoffMs: subscription.delivery_backoff_ms || config.webhooks.backoffMs,
    };
  }

  private buildAircraftPayload(
    state: AircraftStateArray,
    source: string,
    ingestionTimestamp: Date | null,
    sourcePriority?: number,
  ): Record<string, any> {
    const record = mapStateArrayToRecord(state);
    return {
      icao24: record.icao24,
      callsign: record.callsign,
      origin_country: record.origin_country,
      last_contact: record.last_contact,
      position: {
        latitude: record.latitude,
        longitude: record.longitude,
        baro_altitude: record.baro_altitude,
        geo_altitude: record.geo_altitude,
      },
      velocity: record.velocity,
      true_track: record.true_track,
      vertical_rate: record.vertical_rate,
      on_ground: record.on_ground,
      squawk: record.squawk,
      registration: record.registration,
      aircraft_type: record.aircraft_type,
      aircraft_description: record.aircraft_description,
      emergency_status: record.emergency_status,
      source,
      source_priority: sourcePriority ?? null,
      ingestion_timestamp: ingestionTimestamp ? ingestionTimestamp.toISOString() : null,
      recorded_at: new Date().toISOString(),
    };
  }
}

const webhookService = new WebhookService();

export default webhookService;
