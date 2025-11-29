import Stripe from 'stripe';
import config from '../config';
import logger from '../utils/logger';
import postgresRepository from '../repositories/PostgresRepository';
import type { User } from '../types/database.types';

class StripeService {
  private stripe: Stripe;

  constructor() {
    if (!config.stripe.secretKey) {
      logger.warn('Stripe secret key not configured. Stripe features will be disabled.');
      // @ts-ignore - We'll handle this gracefully
      this.stripe = null;
    } else {
      this.stripe = new Stripe(config.stripe.secretKey, {
        apiVersion: config.stripe.apiVersion as Stripe.LatestApiVersion,
      });
    }
  }

  isConfigured(): boolean {
    return this.stripe !== null && config.stripe.secretKey !== undefined;
  }

  async getOrCreateCustomer(user: User): Promise<Stripe.Customer> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    if (user.stripe_customer_id) {
      try {
        const customer = await this.stripe.customers.retrieve(user.stripe_customer_id);
        if (customer.deleted) {
          return this.createCustomer(user);
        }
        return customer as Stripe.Customer;
      } catch (error) {
        logger.warn('Failed to retrieve Stripe customer, creating new one', {
          error: (error as Error).message,
          userId: user.id,
          stripeCustomerId: user.stripe_customer_id,
        });
        return this.createCustomer(user);
      }
    }

    return this.createCustomer(user);
  }

  private async createCustomer(user: User): Promise<Stripe.Customer> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    try {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          user_id: user.id.toString(),
        },
      });

      await postgresRepository.updateUserStripeCustomerId(user.id, customer.id);

      logger.info('Created Stripe customer', {
        userId: user.id,
        stripeCustomerId: customer.id,
      });

      return customer;
    } catch (error) {
      logger.error('Failed to create Stripe customer', {
        error: (error as Error).message,
        userId: user.id,
      });
      throw error;
    }
  }

  async createCheckoutSession(
    customerId: string,
    priceId: string,
    metadata: {
      userId: number;
      productType: 'flight_tracking' | 'efb' | 'api';
      tierName: string;
    },
  ): Promise<Stripe.Checkout.Session> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    try {
      const session = await this.stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${config.stripe.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: config.stripe.cancelUrl,
        metadata: {
          user_id: metadata.userId.toString(),
          product_type: metadata.productType,
          tier_name: metadata.tierName,
        },
        subscription_data: {
          metadata: {
            user_id: metadata.userId.toString(),
            product_type: metadata.productType,
            tier_name: metadata.tierName,
          },
        },
      });

      logger.info('Created Stripe checkout session', {
        sessionId: session.id,
        userId: metadata.userId,
        productType: metadata.productType,
      });

      return session;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create checkout session', {
        error: err.message,
        userId: metadata.userId,
        priceId,
      });
      throw error;
    }
  }

  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      logger.info('Created Stripe portal session', {
        sessionId: session.id,
        customerId,
      });

      return session;
    } catch (error) {
      logger.error('Failed to create portal session', {
        error: (error as Error).message,
        customerId,
      });
      throw error;
    }
  }

  async getCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe.checkout.sessions.retrieve(sessionId);
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true,
  ): Promise<Stripe.Subscription> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    if (cancelAtPeriodEnd) {
      return this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    }
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async reactivateSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
  }

  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    if (!this.isConfigured()) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe.invoices.retrieve(invoiceId);
  }
}

export default new StripeService();
