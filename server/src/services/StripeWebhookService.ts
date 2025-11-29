import type Stripe from 'stripe';
import logger from '../utils/logger';
import subscriptionService from './SubscriptionService';
import subscriptionRepository from '../repositories/SubscriptionRepository';
import invoiceRepository from '../repositories/InvoiceRepository';
import stripeWebhookRepository from '../repositories/StripeWebhookRepository';
import postgresRepository from '../repositories/PostgresRepository';

class StripeWebhookService {
  async processWebhookEvent(event: Stripe.Event): Promise<void> {
    try {
      await stripeWebhookRepository.createWebhookEvent({
        stripe_event_id: event.id,
        event_type: event.type,
        event_data: event.data.object as any,
        processed: false,
      });
    } catch (error) {
      logger.debug('Webhook event already stored', { eventId: event.id });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        case 'customer.subscription.trial_will_end':
          await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
          break;

        default:
          logger.debug('Unhandled webhook event type', { eventType: event.type, eventId: event.id });
      }

      await stripeWebhookRepository.markEventAsProcessed(event.id);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to process webhook event', {
        error: err.message,
        eventId: event.id,
        eventType: event.type,
      });
      await stripeWebhookRepository.markEventAsProcessed(event.id, err.message);
      throw error;
    }
  }

  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (!customerId) {
      logger.warn('Checkout session completed without customer', { sessionId: session.id });
      return;
    }

    const userId = session.metadata?.user_id
      ? parseInt(session.metadata.user_id, 10)
      : null;

    if (!userId) {
      logger.warn('Checkout session completed without user_id in metadata', { sessionId: session.id });
      return;
    }

    if (session.subscription) {
      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription.id;

      logger.info('Checkout session completed', {
        sessionId: session.id,
        userId,
        subscriptionId,
      });
    }
  }

  /**
   * Handle customer.subscription.created event
   */
  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    const user = await postgresRepository.getUserByStripeCustomerId(customerId);
    if (!user) {
      logger.warn('Subscription created for unknown customer', {
        subscriptionId: subscription.id,
        customerId,
      });
      return;
    }

    // Check if subscription already exists
    const existing = await subscriptionRepository.getSubscriptionByStripeId(subscription.id);
    if (existing) {
      logger.debug('Subscription already exists, updating', {
        subscriptionId: existing.id,
        stripeSubscriptionId: subscription.id,
      });
      await subscriptionService.updateSubscriptionFromStripe(subscription);
      return;
    }

    await subscriptionService.createSubscriptionFromStripe(subscription, user.id);

    logger.info('Subscription created', {
      subscriptionId: subscription.id,
      userId: user.id,
    });
  }

  /**
   * Handle customer.subscription.updated event
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const existing = await subscriptionRepository.getSubscriptionByStripeId(subscription.id);
    if (!existing) {
      logger.warn('Subscription updated but not found locally', {
        stripeSubscriptionId: subscription.id,
      });
      // Try to create it
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
      const user = await postgresRepository.getUserByStripeCustomerId(customerId);
      if (user) {
        await subscriptionService.createSubscriptionFromStripe(subscription, user.id);
      }
      return;
    }

    await subscriptionService.updateSubscriptionFromStripe(subscription);

    logger.info('Subscription updated', {
      subscriptionId: existing.id,
      stripeSubscriptionId: subscription.id,
    });
  }

  /**
   * Handle customer.subscription.deleted event
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const existing = await subscriptionRepository.getSubscriptionByStripeId(subscription.id);
    if (!existing) {
      logger.warn('Subscription deleted but not found locally', {
        stripeSubscriptionId: subscription.id,
      });
      return;
    }

    await subscriptionRepository.updateSubscription(existing.id, {
      status: 'canceled',
      canceled_at: new Date(),
    });

    // Sync user flags
    await subscriptionService.syncUserFlags(existing.user_id);

    logger.info('Subscription deleted', {
      subscriptionId: existing.id,
      stripeSubscriptionId: subscription.id,
    });
  }

  /**
   * Handle invoice.paid event
   */
  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id;

    if (!customerId) {
      logger.warn('Invoice paid without customer', { invoiceId: invoice.id });
      return;
    }

    const user = await postgresRepository.getUserByStripeCustomerId(customerId);
    if (!user) {
      logger.warn('Invoice paid for unknown customer', {
        invoiceId: invoice.id,
        customerId,
      });
      return;
    }

    // Check if invoice already exists
    const existing = await invoiceRepository.getInvoiceByStripeId(invoice.id);
    if (existing) {
      await subscriptionService.updateInvoiceFromStripe(invoice);
    } else {
      await subscriptionService.createInvoiceFromStripe(invoice, user.id);
    }

    logger.info('Invoice paid', {
      invoiceId: invoice.id,
      userId: user.id,
    });
  }

  /**
   * Handle invoice.payment_failed event
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id;

    if (!customerId) {
      logger.warn('Invoice payment failed without customer', { invoiceId: invoice.id });
      return;
    }

    const user = await postgresRepository.getUserByStripeCustomerId(customerId);
    if (!user) {
      logger.warn('Invoice payment failed for unknown customer', {
        invoiceId: invoice.id,
        customerId,
      });
      return;
    }

    // Update or create invoice record
    const existing = await invoiceRepository.getInvoiceByStripeId(invoice.id);
    if (existing) {
      await subscriptionService.updateInvoiceFromStripe(invoice);
    } else {
      await subscriptionService.createInvoiceFromStripe(invoice, user.id);
    }

    logger.warn('Invoice payment failed', {
      invoiceId: invoice.id,
      userId: user.id,
    });
  }

  /**
   * Handle customer.subscription.trial_will_end event
   */
  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    const existing = await subscriptionRepository.getSubscriptionByStripeId(subscription.id);
    if (!existing) {
      logger.warn('Trial ending for unknown subscription', {
        stripeSubscriptionId: subscription.id,
      });
      return;
    }

    logger.info('Subscription trial ending soon', {
      subscriptionId: existing.id,
      stripeSubscriptionId: subscription.id,
      trialEnd: subscription.trial_end,
    });

    // Could send notification email here
  }
}

export default new StripeWebhookService();
