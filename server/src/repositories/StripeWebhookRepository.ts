import pgPromise from 'pg-promise';
import type { StripeWebhookEvent } from '../types/database.types';
import { getConnection } from './DatabaseConnection';
import logger from '../utils/logger';

interface CreateWebhookEventData {
  stripe_event_id: string;
  event_type: string;
  event_data: Record<string, any>;
  processed?: boolean;
  processing_error?: string | null;
}

/**
 * Repository for Stripe webhook event management
 */
class StripeWebhookRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  /**
   * Create a new webhook event record
   */
  async createWebhookEvent(data: CreateWebhookEventData): Promise<StripeWebhookEvent> {
    const query = `
      INSERT INTO stripe_webhook_events (
        stripe_event_id, event_type, event_data, processed, processing_error
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    try {
      return await this.db.one<StripeWebhookEvent>(query, [
        data.stripe_event_id,
        data.event_type,
        JSON.stringify(data.event_data),
        data.processed || false,
        data.processing_error || null,
      ]);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create webhook event', { error: err.message, data });
      throw error;
    }
  }

  /**
   * Get webhook event by ID
   */
  async getWebhookEventById(id: number): Promise<StripeWebhookEvent | null> {
    const query = 'SELECT * FROM stripe_webhook_events WHERE id = $1';
    return this.db.oneOrNone<StripeWebhookEvent>(query, [id]);
  }

  /**
   * Get webhook event by Stripe event ID
   */
  async getWebhookEventByStripeId(stripeEventId: string): Promise<StripeWebhookEvent | null> {
    const query = 'SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1';
    return this.db.oneOrNone<StripeWebhookEvent>(query, [stripeEventId]);
  }

  /**
   * Mark webhook event as processed
   */
  async markEventAsProcessed(stripeEventId: string, error?: string | null): Promise<void> {
    const query = `
      UPDATE stripe_webhook_events 
      SET processed = true, 
          processing_error = $1,
          processed_at = CURRENT_TIMESTAMP
      WHERE stripe_event_id = $2
    `;
    await this.db.none(query, [error || null, stripeEventId]);
  }

  /**
   * Get unprocessed webhook events
   */
  async getUnprocessedEvents(limit: number = 100): Promise<StripeWebhookEvent[]> {
    const query = `
      SELECT * FROM stripe_webhook_events 
      WHERE processed = false 
      ORDER BY created_at ASC 
      LIMIT $1
    `;
    return this.db.manyOrNone<StripeWebhookEvent>(query, [limit]) || [];
  }

  /**
   * Get webhook events by type
   */
  async getEventsByType(eventType: string, limit: number = 50): Promise<StripeWebhookEvent[]> {
    const query = `
      SELECT * FROM stripe_webhook_events 
      WHERE event_type = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    return this.db.manyOrNone<StripeWebhookEvent>(query, [eventType, limit]) || [];
  }
}

export default new StripeWebhookRepository();
