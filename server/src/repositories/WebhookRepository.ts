import pgPromise from 'pg-promise';
import { getConnection } from './DatabaseConnection';
import logger from '../utils/logger';
import type { WebhookDelivery, WebhookEvent, WebhookSubscription } from '../types/database.types';

export interface CreateSubscriptionInput {
  name: string;
  subscriber_id: string;
  callback_url: string;
  event_types: string[];
  signing_secret: string;
  status?: 'active' | 'paused' | 'disabled';
  rate_limit_per_minute?: number;
  delivery_max_attempts?: number;
  delivery_backoff_ms?: number;
  metadata?: Record<string, any>;
}

export interface CreateEventInput {
  event_id: string;
  event_type: string;
  payload: Record<string, any>;
  occurred_at: Date;
  version?: string;
}

export interface CreateDeliveryInput {
  delivery_id: string;
  event_id: string;
  subscription_id: number;
  status?: 'pending' | 'delivering' | 'success' | 'failed';
  attempt_count?: number;
  next_attempt_at?: Date | null;
}

class WebhookRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<WebhookSubscription> {
    const {
      name,
      subscriber_id,
      callback_url,
      event_types,
      signing_secret,
      status = 'active',
      rate_limit_per_minute = 120,
      delivery_max_attempts = 6,
      delivery_backoff_ms = 15000,
      metadata = null,
    } = input;

    const query = `
      INSERT INTO webhook_subscriptions (
        name, subscriber_id, callback_url, event_types, signing_secret, status,
        rate_limit_per_minute, delivery_max_attempts, delivery_backoff_ms, metadata, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      RETURNING *;
    `;

    return this.db.one(query, [
      name,
      subscriber_id,
      callback_url,
      event_types,
      signing_secret,
      status,
      rate_limit_per_minute,
      delivery_max_attempts,
      delivery_backoff_ms,
      metadata,
    ]);
  }

  async listSubscriptions(status?: string): Promise<WebhookSubscription[]> {
    if (status) {
      return this.db.manyOrNone('SELECT * FROM webhook_subscriptions WHERE status = $1 ORDER BY id DESC', [status]);
    }
    return this.db.manyOrNone('SELECT * FROM webhook_subscriptions ORDER BY id DESC');
  }

  async findActiveSubscriptionsForEvent(eventType: string): Promise<WebhookSubscription[]> {
    const query = `
      SELECT *
      FROM webhook_subscriptions
      WHERE status = 'active'
      AND (
        event_types @> ARRAY[$1]
        OR '*' = ANY(event_types)
        OR 'all' = ANY(event_types)
      )
    `;
    return this.db.manyOrNone(query, [eventType]);
  }

  async createEvent(input: CreateEventInput): Promise<WebhookEvent> {
    const {
      event_id, event_type, payload, occurred_at, version = 'v1',
    } = input;

    const query = `
      INSERT INTO webhook_events (event_id, event_type, payload, occurred_at, version)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    return this.db.one(query, [event_id, event_type, payload, occurred_at, version]);
  }

  async createDelivery(input: CreateDeliveryInput): Promise<WebhookDelivery> {
    const {
      delivery_id,
      event_id,
      subscription_id,
      status = 'pending',
      attempt_count = 0,
      next_attempt_at = new Date(),
    } = input;

    const query = `
      INSERT INTO webhook_deliveries (
        delivery_id, event_id, subscription_id, status, attempt_count,
        next_attempt_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *;
    `;

    return this.db.one(query, [
      delivery_id,
      event_id,
      subscription_id,
      status,
      attempt_count,
      next_attempt_at,
    ]);
  }

  async markDeliveryAttempt(
    deliveryId: string,
    fields: Partial<Pick<WebhookDelivery, 'status' | 'attempt_count' | 'next_attempt_at' | 'last_error' | 'response_status' | 'response_body' | 'last_attempt_at'>>,
  ): Promise<void> {
    const columns = [];
    const values: any[] = [];

    const setField = (column: string, value: any) => {
      columns.push(`${column} = $${columns.length + 1}`);
      values.push(value);
    };

    if (fields.status) setField('status', fields.status);
    if (fields.attempt_count !== undefined) setField('attempt_count', fields.attempt_count);
    if (fields.next_attempt_at !== undefined) setField('next_attempt_at', fields.next_attempt_at);
    if (fields.last_error !== undefined) setField('last_error', fields.last_error);
    if (fields.response_status !== undefined) setField('response_status', fields.response_status);
    if (fields.response_body !== undefined) setField('response_body', fields.response_body);
    if (fields.last_attempt_at !== undefined) setField('last_attempt_at', fields.last_attempt_at);

    setField('updated_at', new Date());

    const query = `
      UPDATE webhook_deliveries
      SET ${columns.join(', ')}
      WHERE delivery_id = $${columns.length + 1}
    `;
    values.push(deliveryId);

    await this.db.none(query, values);
  }

  async markSubscriptionSuccess(subscriptionId: number): Promise<void> {
    const query = `
      UPDATE webhook_subscriptions
      SET last_success_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;

    try {
      await this.db.none(query, [subscriptionId]);
    } catch (error) {
      const err = error as Error;
      logger.warn('Failed to update subscription success timestamp', { error: err.message, subscriptionId });
    }
  }
}

export default WebhookRepository;
