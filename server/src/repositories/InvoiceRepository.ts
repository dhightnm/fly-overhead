import pgPromise from 'pg-promise';
import type { Invoice } from '../types/database.types';
import { getConnection } from './DatabaseConnection';
import logger from '../utils/logger';

interface CreateInvoiceData {
  user_id: number;
  subscription_id: number | null;
  stripe_invoice_id: string;
  stripe_customer_id: string;
  amount: number;
  currency?: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  period_start?: Date | null;
  period_end?: Date | null;
  paid_at?: Date | null;
  metadata?: Record<string, any> | null;
}

interface UpdateInvoiceData {
  status?: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  paid_at?: Date | null;
  metadata?: Record<string, any> | null;
}

/**
 * Repository for invoice management
 */
class InvoiceRepository {
  private db: pgPromise.IDatabase<any>;

  constructor() {
    this.db = getConnection().getDb();
  }

  /**
   * Create a new invoice
   */
  async createInvoice(data: CreateInvoiceData): Promise<Invoice> {
    const query = `
      INSERT INTO invoices (
        user_id, subscription_id, stripe_invoice_id, stripe_customer_id,
        amount, currency, status, hosted_invoice_url, invoice_pdf,
        period_start, period_end, paid_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;
    try {
      return await this.db.one<Invoice>(query, [
        data.user_id,
        data.subscription_id,
        data.stripe_invoice_id,
        data.stripe_customer_id,
        data.amount,
        data.currency || 'usd',
        data.status,
        data.hosted_invoice_url || null,
        data.invoice_pdf || null,
        data.period_start || null,
        data.period_end || null,
        data.paid_at || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create invoice', { error: err.message, data });
      throw error;
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoiceById(id: number): Promise<Invoice | null> {
    const query = 'SELECT * FROM invoices WHERE id = $1';
    return this.db.oneOrNone<Invoice>(query, [id]);
  }

  /**
   * Get invoice by Stripe invoice ID
   */
  async getInvoiceByStripeId(stripeInvoiceId: string): Promise<Invoice | null> {
    const query = 'SELECT * FROM invoices WHERE stripe_invoice_id = $1';
    return this.db.oneOrNone<Invoice>(query, [stripeInvoiceId]);
  }

  /**
   * Get all invoices for a user
   */
  async getUserInvoices(userId: number, limit: number = 50): Promise<Invoice[]> {
    const query = `
      SELECT * FROM invoices 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    return this.db.manyOrNone<Invoice>(query, [userId, limit]) || [];
  }

  /**
   * Get invoices for a subscription
   */
  async getSubscriptionInvoices(subscriptionId: number): Promise<Invoice[]> {
    const query = `
      SELECT * FROM invoices 
      WHERE subscription_id = $1 
      ORDER BY created_at DESC
    `;
    return this.db.manyOrNone<Invoice>(query, [subscriptionId]) || [];
  }

  /**
   * Update invoice
   */
  async updateInvoice(id: number, data: UpdateInvoiceData): Promise<Invoice> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.hosted_invoice_url !== undefined) {
      updates.push(`hosted_invoice_url = $${paramIndex++}`);
      values.push(data.hosted_invoice_url);
    }
    if (data.invoice_pdf !== undefined) {
      updates.push(`invoice_pdf = $${paramIndex++}`);
      values.push(data.invoice_pdf);
    }
    if (data.paid_at !== undefined) {
      updates.push(`paid_at = $${paramIndex++}`);
      values.push(data.paid_at);
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }

    if (updates.length === 0) {
      return this.getInvoiceById(id) as Promise<Invoice>;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `
      UPDATE invoices 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    try {
      return await this.db.one<Invoice>(query, values);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update invoice', { error: err.message, id, data });
      throw error;
    }
  }

  /**
   * Delete invoice
   */
  async deleteInvoice(id: number): Promise<void> {
    const query = 'DELETE FROM invoices WHERE id = $1';
    await this.db.none(query, [id]);
  }
}

export default new InvoiceRepository();
