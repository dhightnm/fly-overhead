import {
  Router,
  Request,
  Response,
  NextFunction,
} from 'express';
import Stripe from 'stripe';
import config from '../config';
import logger from '../utils/logger';
import stripeService from '../services/StripeService';
import stripeWebhookService from '../services/StripeWebhookService';
import { authenticateToken, type AuthenticatedRequest } from './auth.routes';
import postgresRepository from '../repositories/PostgresRepository';

const router = Router();

router.post(
  '/checkout',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { productType, tierName, priceId } = req.body;

      if (!productType || !tierName || !priceId) {
        return res.status(400).json({
          error: 'Missing required fields: productType, tierName, priceId',
        });
      }

      if (!['flight_tracking', 'efb', 'api'].includes(productType)) {
        return res.status(400).json({
          error: 'Invalid productType. Must be flight_tracking, efb, or api',
        });
      }

      const user = await postgresRepository.getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const customer = await stripeService.getOrCreateCustomer(user);
      const session = await stripeService.createCheckoutSession(customer.id, priceId, {
        userId: user.id,
        productType,
        tierName,
      });

      return res.json({
        sessionId: session.id,
        url: session.url,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Create checkout session error', { error: err.message });
      return next(error);
    }
  },
);

router.get(
  '/checkout/success',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { session_id } = req.query;

      if (!session_id || typeof session_id !== 'string') {
        return res.status(400).json({ error: 'Missing session_id' });
      }

      const session = await stripeService.getCheckoutSession(session_id);

      return res.json({
        success: true,
        sessionId: session.id,
        customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Checkout success error', { error: err.message });
      return next(error);
    }
  },
);

router.get(
  '/checkout/cancel',
  authenticateToken,
  async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      return res.json({
        canceled: true,
        message: 'Checkout was canceled',
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Checkout cancel error', { error: err.message });
      return next(error);
    }
  },
);

router.post(
  '/portal',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { returnUrl } = req.body;

      const user = await postgresRepository.getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.stripe_customer_id) {
        return res.status(400).json({
          error: 'User does not have a Stripe customer ID',
        });
      }

      const session = await stripeService.createPortalSession(
        user.stripe_customer_id,
        returnUrl || config.stripe.cancelUrl,
      );

      return res.json({
        url: session.url,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Create portal session error', { error: err.message });
      return next(error);
    }
  },
);

// Webhook endpoint - uses raw body for signature verification
router.post(
  '/webhooks',
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];

    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    if (!config.stripe.webhookSecret) {
      logger.error('Stripe webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = Stripe.webhooks.constructEvent(
        req.body,
        sig,
        config.stripe.webhookSecret,
      ) as Stripe.Event;
    } catch (err) {
      const error = err as Error;
      logger.error('Webhook signature verification failed', { error: error.message });
      return res.status(400).json({ error: `Webhook Error: ${error.message}` });
    }

    stripeWebhookService.processWebhookEvent(event).catch((error) => {
      logger.error('Error processing webhook event', {
        error: (error as Error).message,
        eventId: event.id,
        eventType: event.type,
      });
    });

    return res.json({ received: true });
  },
);

export default router;
