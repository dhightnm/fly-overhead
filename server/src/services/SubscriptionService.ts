import type Stripe from 'stripe';
import logger from '../utils/logger';
import stripeService from './StripeService';
import subscriptionRepository from '../repositories/SubscriptionRepository';
import invoiceRepository from '../repositories/InvoiceRepository';
import postgresRepository from '../repositories/PostgresRepository';
import type { Subscription, Invoice } from '../types/database.types';

class SubscriptionService {
  async createSubscriptionFromStripe(
    stripeSubscription: Stripe.Subscription,
    userId: number,
  ): Promise<Subscription> {
    try {
      const customerId = typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer.id;

      const priceId = typeof stripeSubscription.items.data[0]?.price === 'string'
        ? stripeSubscription.items.data[0].price
        : stripeSubscription.items.data[0]?.price.id || '';

      const metadata = stripeSubscription.metadata || {};
      const productType = (metadata.product_type as 'flight_tracking' | 'efb' | 'api') || 'api';
      const tierName = metadata.tier_name || 'unknown';

      const subscription = await subscriptionRepository.createSubscription({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: stripeSubscription.id,
        stripe_price_id: priceId,
        product_type: productType,
        tier_name: tierName,
        status: this.mapStripeStatusToLocal(stripeSubscription.status),
        current_period_start: new Date(stripeSubscription.current_period_start * 1000),
        current_period_end: new Date(stripeSubscription.current_period_end * 1000),
        cancel_at_period_end: stripeSubscription.cancel_at_period_end || false,
        canceled_at: stripeSubscription.canceled_at
          ? new Date(stripeSubscription.canceled_at * 1000)
          : null,
        trial_start: stripeSubscription.trial_start
          ? new Date(stripeSubscription.trial_start * 1000)
          : null,
        trial_end: stripeSubscription.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        metadata: stripeSubscription.metadata || null,
      });

      await this.syncUserFlags(userId);

      logger.info('Created subscription from Stripe', {
        subscriptionId: subscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        userId,
      });

      return subscription;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create subscription from Stripe', {
        error: err.message,
        userId,
        stripeSubscriptionId: stripeSubscription.id,
      });
      throw error;
    }
  }

  async updateSubscriptionFromStripe(
    stripeSubscription: Stripe.Subscription,
  ): Promise<Subscription> {
    try {
      const existingSubscription = await subscriptionRepository.getSubscriptionByStripeId(
        stripeSubscription.id,
      );

      if (!existingSubscription) {
        throw new Error(`Subscription not found for Stripe ID: ${stripeSubscription.id}`);
      }

      const updated = await subscriptionRepository.updateSubscription(existingSubscription.id, {
        status: this.mapStripeStatusToLocal(stripeSubscription.status),
        current_period_start: new Date(stripeSubscription.current_period_start * 1000),
        current_period_end: new Date(stripeSubscription.current_period_end * 1000),
        cancel_at_period_end: stripeSubscription.cancel_at_period_end || false,
        canceled_at: stripeSubscription.canceled_at
          ? new Date(stripeSubscription.canceled_at * 1000)
          : null,
        trial_start: stripeSubscription.trial_start
          ? new Date(stripeSubscription.trial_start * 1000)
          : null,
        trial_end: stripeSubscription.trial_end
          ? new Date(stripeSubscription.trial_end * 1000)
          : null,
        metadata: stripeSubscription.metadata || null,
      });

      await this.syncUserFlags(existingSubscription.user_id);

      logger.info('Updated subscription from Stripe', {
        subscriptionId: updated.id,
        stripeSubscriptionId: stripeSubscription.id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update subscription from Stripe', {
        error: err.message,
        stripeSubscriptionId: stripeSubscription.id,
      });
      throw error;
    }
  }

  async createInvoiceFromStripe(
    stripeInvoice: Stripe.Invoice,
    userId: number,
  ): Promise<Invoice> {
    try {
      const customerId = typeof stripeInvoice.customer === 'string'
        ? stripeInvoice.customer
        : stripeInvoice.customer?.id || '';

      const subscriptionId = typeof stripeInvoice.subscription === 'string'
        ? stripeInvoice.subscription
        : stripeInvoice.subscription?.id || null;

      let localSubscriptionId: number | null = null;
      if (subscriptionId) {
        const subscription = await subscriptionRepository.getSubscriptionByStripeId(subscriptionId);
        localSubscriptionId = subscription?.id || null;
      }

      const invoice = await invoiceRepository.createInvoice({
        user_id: userId,
        subscription_id: localSubscriptionId,
        stripe_invoice_id: stripeInvoice.id,
        stripe_customer_id: customerId,
        amount: stripeInvoice.amount_paid || stripeInvoice.amount_due || 0,
        currency: stripeInvoice.currency || 'usd',
        status: this.mapStripeInvoiceStatusToLocal(stripeInvoice.status),
        hosted_invoice_url: stripeInvoice.hosted_invoice_url || null,
        invoice_pdf: stripeInvoice.invoice_pdf || null,
        period_start: stripeInvoice.period_start
          ? new Date(stripeInvoice.period_start * 1000)
          : null,
        period_end: stripeInvoice.period_end
          ? new Date(stripeInvoice.period_end * 1000)
          : null,
        paid_at: stripeInvoice.status_transitions?.paid_at
          ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
          : null,
        metadata: stripeInvoice.metadata || null,
      });

      logger.info('Created invoice from Stripe', {
        invoiceId: invoice.id,
        stripeInvoiceId: stripeInvoice.id,
        userId,
      });

      return invoice;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create invoice from Stripe', {
        error: err.message,
        userId,
        stripeInvoiceId: stripeInvoice.id,
      });
      throw error;
    }
  }

  async updateInvoiceFromStripe(stripeInvoice: Stripe.Invoice): Promise<Invoice> {
    try {
      const existingInvoice = await invoiceRepository.getInvoiceByStripeId(stripeInvoice.id);

      if (!existingInvoice) {
        throw new Error(`Invoice not found for Stripe ID: ${stripeInvoice.id}`);
      }

      const updated = await invoiceRepository.updateInvoice(existingInvoice.id, {
        status: this.mapStripeInvoiceStatusToLocal(stripeInvoice.status),
        hosted_invoice_url: stripeInvoice.hosted_invoice_url || null,
        invoice_pdf: stripeInvoice.invoice_pdf || null,
        paid_at: stripeInvoice.status_transitions?.paid_at
          ? new Date(stripeInvoice.status_transitions.paid_at * 1000)
          : null,
        metadata: stripeInvoice.metadata || null,
      });

      logger.info('Updated invoice from Stripe', {
        invoiceId: updated.id,
        stripeInvoiceId: stripeInvoice.id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to update invoice from Stripe', {
        error: err.message,
        stripeInvoiceId: stripeInvoice.id,
      });
      throw error;
    }
  }

  async cancelSubscription(
    subscriptionId: number,
    cancelAtPeriodEnd: boolean = true,
  ): Promise<Subscription> {
    const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (!subscription.stripe_subscription_id) {
      throw new Error('Subscription does not have a Stripe subscription ID');
    }

    const stripeSubscription = await stripeService.cancelSubscription(
      subscription.stripe_subscription_id,
      cancelAtPeriodEnd,
    );

    return this.updateSubscriptionFromStripe(stripeSubscription);
  }

  async reactivateSubscription(subscriptionId: number): Promise<Subscription> {
    const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (!subscription.stripe_subscription_id) {
      throw new Error('Subscription does not have a Stripe subscription ID');
    }

    const stripeSubscription = await stripeService.reactivateSubscription(
      subscription.stripe_subscription_id,
    );

    return this.updateSubscriptionFromStripe(stripeSubscription);
  }

  async syncUserFlags(userId: number): Promise<void> {
    const activeSubscriptions = await subscriptionRepository.getActiveUserSubscriptions(userId);

    const flags = {
      is_premium: false,
      is_efb: false,
      is_api: false,
    };

    for (const subscription of activeSubscriptions) {
      if (subscription.product_type === 'flight_tracking') {
        if (['professional', 'enterprise'].includes(subscription.tier_name.toLowerCase())) {
          flags.is_premium = true;
        }
      } else if (subscription.product_type === 'efb') {
        flags.is_efb = true;
      } else if (subscription.product_type === 'api') {
        if (['starter', 'professional', 'enterprise'].includes(subscription.tier_name.toLowerCase())) {
          flags.is_api = true;
        }
      }
    }

    await postgresRepository.updateUserSubscriptionFlags(userId, flags);

    logger.info('Synced user subscription flags', {
      userId,
      flags,
      activeSubscriptionsCount: activeSubscriptions.length,
    });
  }

  private mapStripeStatusToLocal(
    stripeStatus: Stripe.Subscription.Status,
  ): 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused' {
    switch (stripeStatus) {
      case 'active':
        return 'active';
      case 'canceled':
        return 'canceled';
      case 'past_due':
        return 'past_due';
      case 'unpaid':
        return 'unpaid';
      case 'trialing':
        return 'trialing';
      case 'paused':
        return 'paused';
      default:
        return 'canceled';
    }
  }

  private mapStripeInvoiceStatusToLocal(
    stripeStatus: Stripe.Invoice.Status | null,
  ): 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' {
    switch (stripeStatus) {
      case 'draft':
        return 'draft';
      case 'open':
        return 'open';
      case 'paid':
        return 'paid';
      case 'uncollectible':
        return 'uncollectible';
      case 'void':
        return 'void';
      default:
        return 'draft';
    }
  }
}

export default new SubscriptionService();
