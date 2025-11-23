import express, { type Request, type Response } from 'express';
import crypto from 'crypto';
import { requireApiKeyAuth } from '../middlewares/apiKeyAuth';
import { requireScopes } from '../middlewares/permissionMiddleware';
import { API_SCOPES } from '../config/scopes';
import webhookService from '../services/WebhookService';
import logger from '../utils/logger';

const router = express.Router();

router.use(requireApiKeyAuth);

router.get(
  '/subscriptions',
  requireScopes(API_SCOPES.ADMIN_ALL, API_SCOPES.INTERNAL_ALL),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { status } = req.query;
      const subscriptions = await webhookService.listSubscriptions(
        typeof status === 'string' ? status : undefined,
      );
      res.json({ subscriptions });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to list webhook subscriptions', { error: err.message });
      res.status(500).json({ error: 'Failed to list webhook subscriptions' });
    }
  },
);

router.post(
  '/subscriptions',
  requireScopes(API_SCOPES.ADMIN_ALL, API_SCOPES.INTERNAL_ALL),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        subscriberId,
        callbackUrl,
        eventTypes,
        signingSecret,
        rateLimitPerMinute,
        deliveryMaxAttempts,
        deliveryBackoffMs,
        metadata,
      } = req.body || {};

      if (!name || !subscriberId || !callbackUrl || !Array.isArray(eventTypes) || eventTypes.length === 0) {
        res.status(400).json({
          error: 'name, subscriberId, callbackUrl, and eventTypes[] are required',
        });
        return;
      }

      const secret = signingSecret || crypto.randomBytes(32).toString('hex');

      const subscription = await webhookService.registerSubscription({
        name,
        subscriberId,
        callbackUrl,
        eventTypes,
        signingSecret: secret,
        rateLimitPerMinute,
        deliveryMaxAttempts,
        deliveryBackoffMs,
        metadata,
      });

      res.status(201).json({
        subscription,
        signing_secret: secret,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to create webhook subscription', { error: err.message });
      res.status(500).json({ error: 'Failed to create webhook subscription' });
    }
  },
);

router.post(
  '/events/test',
  requireScopes(API_SCOPES.ADMIN_ALL, API_SCOPES.INTERNAL_ALL),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { eventType, payload } = req.body || {};
      const type = typeof eventType === 'string' ? eventType : 'webhook.test';
      const body = payload && typeof payload === 'object'
        ? payload
        : { message: 'webhook test', source: 'manual' };

      const result = await webhookService.publishEvent(type, body);
      res.status(202).json(result);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to publish test webhook event', { error: err.message });
      res.status(500).json({ error: 'Failed to publish test webhook event' });
    }
  },
);

export default router;
