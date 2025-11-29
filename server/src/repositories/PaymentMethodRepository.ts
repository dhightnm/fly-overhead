import pgPromise from 'pg-promise';
import type { PaymentMethod } from '../types/database.types';
import { getConnection } from './DatabaseConnection';
import logger from '../utils/logger';

interface CreatePaymentMethodData {
  user_id: number;
  stripe_payment_method_id: string;
  stripe_customer_id: string;
  type: 'card' | 'bank_account';
  is_default?: boolean;
  card_brand?: string | null;
  card_last4?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
  billing_details?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
}

interface UpdatePaymentMethodData {
  is_default?: boolean;
  card_brand?: string | null;
  card_last4?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
  billing_details?: Record<string, any> | null;
  metadata?: Record<string, any> | null;
}

/**
 * Repository for payment method management
 */
class PaymentMethodRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  /**
   * Create a new payment method
   */
  async createPaymentMethod(data: CreatePaymentMethodData): Promise<PaymentMethod> {
    const query = `
      INSERT INTO payment_methods (
        user_id, stripe_payment_method_id, stripe_customer_id, type,
        is_default, card_brand, card_last4, card_exp_month, card_exp_year,
        billing_details, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    try {
      // If this is set as default, unset other defaults for this user
      if (data.is_default) {
        await this.unsetDefaultPaymentMethods(data.user_id);
      }

      return await this.db.one<PaymentMethod>(query, [
        data.user_id,
        data.stripe_payment_method_id,
        data.stripe_customer_id,
        data.type,
        data.is_default || false,
        data.card_brand || null,
        data.card_last4 || null,
        data.card_exp_month || null,
        data.card_exp_year || null,
        data.billing_details ? JSON.stringify(data.billing_details) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create payment method', { error: err.message, data });
      throw error;
    }
  }

  /**
   * Get payment method by ID
   */
  async getPaymentMethodById(id: number): Promise<PaymentMethod | null> {
    const query = 'SELECT * FROM payment_methods WHERE id = $1';
    return this.db.oneOrNone<PaymentMethod>(query, [id]);
  }

  /**
   * Get payment method by Stripe payment method ID
   */
  async getPaymentMethodByStripeId(stripePaymentMethodId: string): Promise<PaymentMethod | null> {
    const query = 'SELECT * FROM payment_methods WHERE stripe_payment_method_id = $1';
    return this.db.oneOrNone<PaymentMethod>(query, [stripePaymentMethodId]);
  }

  /**
   * Get all payment methods for a user
   */
  async getUserPaymentMethods(userId: number): Promise<PaymentMethod[]> {
    const query = 'SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC';
    return this.db.manyOrNone<PaymentMethod>(query, [userId]) || [];
  }

  /**
   * Get default payment method for a user
   */
  async getDefaultPaymentMethod(userId: number): Promise<PaymentMethod | null> {
    const query = 'SELECT * FROM payment_methods WHERE user_id = $1 AND is_default = true LIMIT 1';
    return this.db.oneOrNone<PaymentMethod>(query, [userId]);
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(id: number, data: UpdatePaymentMethodData): Promise<PaymentMethod> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.is_default !== undefined) {
      updates.push(`is_default = $${paramIndex++}`);
      values.push(data.is_default);

      // If setting as default, unset other defaults for this user
      if (data.is_default) {
        const paymentMethod = await this.getPaymentMethodById(id);
        if (paymentMethod) {
          await this.unsetDefaultPaymentMethods(paymentMethod.user_id, id);
        }
      }
    }
    if (data.card_brand !== undefined) {
      updates.push(`card_brand = $${paramIndex++}`);
      values.push(data.card_brand);
    }
    if (data.card_last4 !== undefined) {
      updates.push(`card_last4 = $${paramIndex++}`);
      values.push(data.card_last4);
    }
    if (data.card_exp_month !== undefined) {
      updates.push(`card_exp_month = $${paramIndex++}`);
      values.push(data.card_exp_month);
    }
    if (data.card_exp_year !== undefined) {
      updates.push(`card_exp_year = $${paramIndex++}`);
      values.push(data.card_exp_year);
    }
    if (data.billing_details !== undefined) {
      updates.push(`billing_details = $${paramIndex++}`);
      values.push(data.billing_details ? JSON.stringify(data.billing_details) : null);
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }

    if (updates.length === 0) {
      return this.getPaymentMethodById(id) as Promise<PaymentMethod>;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE payment_methods 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      return await this.db.one<PaymentMethod>(query, values);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update payment method', { error: err.message, id, data });
      throw error;
    }
  }

  /**
   * Delete payment method
   */
  async deletePaymentMethod(id: number): Promise<void> {
    const query = 'DELETE FROM payment_methods WHERE id = $1';
    await this.db.none(query, [id]);
  }

  /**
   * Unset default payment methods for a user (except the specified one)
   */
  private async unsetDefaultPaymentMethods(userId: number, exceptId?: number): Promise<void> {
    const query = exceptId
      ? 'UPDATE payment_methods SET is_default = false WHERE user_id = $1 AND id != $2'
      : 'UPDATE payment_methods SET is_default = false WHERE user_id = $1';

    const params = exceptId ? [userId, exceptId] : [userId];
    await this.db.none(query, params);
  }
}

export default new PaymentMethodRepository();
