import pgPromise from 'pg-promise';
import type { Subscription } from '../types/database.types';
import { getConnection } from './DatabaseConnection';
import logger from '../utils/logger';

interface CreateSubscriptionData {
  user_id: number;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string;
  product_type: 'flight_tracking' | 'efb' | 'api';
  tier_name: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
  current_period_start: Date;
  current_period_end: Date;
  cancel_at_period_end?: boolean;
  canceled_at?: Date | null;
  trial_start?: Date | null;
  trial_end?: Date | null;
  metadata?: Record<string, any> | null;
}

interface UpdateSubscriptionData {
  stripe_subscription_id?: string;
  status?: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
  current_period_start?: Date;
  current_period_end?: Date;
  cancel_at_period_end?: boolean;
  canceled_at?: Date | null;
  trial_start?: Date | null;
  trial_end?: Date | null;
  metadata?: Record<string, any> | null;
}

class SubscriptionRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  /**
   * Create a new subscription
   */
  async createSubscription(data: CreateSubscriptionData): Promise<Subscription> {
    const query = `
      INSERT INTO subscriptions (
        user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
        product_type, tier_name, status, current_period_start, current_period_end,
        cancel_at_period_end, canceled_at, trial_start, trial_end, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    try {
      return await this.db.one<Subscription>(query, [
        data.user_id,
        data.stripe_customer_id,
        data.stripe_subscription_id,
        data.stripe_price_id,
        data.product_type,
        data.tier_name,
        data.status,
        data.current_period_start,
        data.current_period_end,
        data.cancel_at_period_end || false,
        data.canceled_at || null,
        data.trial_start || null,
        data.trial_end || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create subscription', { error: err.message, data });
      throw error;
    }
  }

  /**
   * Get subscription by ID
   */
  async getSubscriptionById(id: number): Promise<Subscription | null> {
    const query = 'SELECT * FROM subscriptions WHERE id = $1';
    return this.db.oneOrNone<Subscription>(query, [id]);
  }

  /**
   * Get subscription by Stripe subscription ID
   */
  async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    const query = 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1';
    return this.db.oneOrNone<Subscription>(query, [stripeSubscriptionId]);
  }

  /**
   * Get all subscriptions for a user
   */
  async getUserSubscriptions(userId: number): Promise<Subscription[]> {
    const query = 'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC';
    return this.db.manyOrNone<Subscription>(query, [userId]) || [];
  }

  /**
   * Get active subscriptions for a user
   */
  async getActiveUserSubscriptions(userId: number): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions 
      WHERE user_id = $1 AND status IN ('active', 'trialing')
      ORDER BY created_at DESC
    `;
    return this.db.manyOrNone<Subscription>(query, [userId]) || [];
  }

  /**
   * Get subscriptions by product type
   */
  async getSubscriptionsByProductType(
    userId: number,
    productType: 'flight_tracking' | 'efb' | 'api',
  ): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions 
      WHERE user_id = $1 AND product_type = $2
      ORDER BY created_at DESC
    `;
    return this.db.manyOrNone<Subscription>(query, [userId, productType]) || [];
  }

  /**
   * Update subscription
   */
  async updateSubscription(id: number, data: UpdateSubscriptionData): Promise<Subscription> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.stripe_subscription_id !== undefined) {
      updates.push(`stripe_subscription_id = $${paramIndex++}`);
      values.push(data.stripe_subscription_id);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.current_period_start !== undefined) {
      updates.push(`current_period_start = $${paramIndex++}`);
      values.push(data.current_period_start);
    }
    if (data.current_period_end !== undefined) {
      updates.push(`current_period_end = $${paramIndex++}`);
      values.push(data.current_period_end);
    }
    if (data.cancel_at_period_end !== undefined) {
      updates.push(`cancel_at_period_end = $${paramIndex++}`);
      values.push(data.cancel_at_period_end);
    }
    if (data.canceled_at !== undefined) {
      updates.push(`canceled_at = $${paramIndex++}`);
      values.push(data.canceled_at);
    }
    if (data.trial_start !== undefined) {
      updates.push(`trial_start = $${paramIndex++}`);
      values.push(data.trial_start);
    }
    if (data.trial_end !== undefined) {
      updates.push(`trial_end = $${paramIndex++}`);
      values.push(data.trial_end);
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }

    if (updates.length === 0) {
      return this.getSubscriptionById(id) as Promise<Subscription>;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE subscriptions 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      return await this.db.one<Subscription>(query, values);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update subscription', { error: err.message, id, data });
      throw error;
    }
  }

  /**
   * Delete subscription
   */
  async deleteSubscription(id: number): Promise<void> {
    const query = 'DELETE FROM subscriptions WHERE id = $1';
    await this.db.none(query, [id]);
  }

  /**
   * Get subscription by user and product type (for checking existing subscriptions)
   */
  async getActiveSubscriptionByProductType(
    userId: number,
    productType: 'flight_tracking' | 'efb' | 'api',
  ): Promise<Subscription | null> {
    const query = `
      SELECT * FROM subscriptions 
      WHERE user_id = $1 
        AND product_type = $2 
        AND status IN ('active', 'trialing')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return this.db.oneOrNone<Subscription>(query, [userId, productType]);
  }
}

export default new SubscriptionRepository();
