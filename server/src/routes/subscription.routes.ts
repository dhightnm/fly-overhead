import { Router, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import subscriptionService from '../services/SubscriptionService';
import subscriptionRepository from '../repositories/SubscriptionRepository';
import invoiceRepository from '../repositories/InvoiceRepository';
import { authenticateToken, type AuthenticatedRequest } from './auth.routes';

const router = Router();

router.get(
  '/',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const subscriptions = await subscriptionRepository.getUserSubscriptions(req.user!.userId);

      return res.json({
        subscriptions: subscriptions.map((sub) => ({
          id: sub.id,
          productType: sub.product_type,
          tierName: sub.tier_name,
          status: sub.status,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          canceledAt: sub.canceled_at,
          trialStart: sub.trial_start,
          trialEnd: sub.trial_end,
          createdAt: sub.created_at,
        })),
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Get subscriptions error', { error: err.message });
      return next(error);
    }
  },
);

router.get(
  '/:id',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const subscriptionId = parseInt(req.params.id, 10);

      if (Number.isNaN(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }

      const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      if (subscription.user_id !== req.user!.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const invoices = await invoiceRepository.getSubscriptionInvoices(subscription.id);

      return res.json({
        id: subscription.id,
        productType: subscription.product_type,
        tierName: subscription.tier_name,
        status: subscription.status,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at,
        trialStart: subscription.trial_start,
        trialEnd: subscription.trial_end,
        createdAt: subscription.created_at,
        invoices: invoices.map((inv) => ({
          id: inv.id,
          amount: inv.amount,
          currency: inv.currency,
          status: inv.status,
          periodStart: inv.period_start,
          periodEnd: inv.period_end,
          paidAt: inv.paid_at,
          hostedInvoiceUrl: inv.hosted_invoice_url,
          createdAt: inv.created_at,
        })),
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Get subscription error', { error: err.message });
      return next(error);
    }
  },
);

router.post(
  '/:id/cancel',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const subscriptionId = parseInt(req.params.id, 10);
      const { cancelAtPeriodEnd } = req.body;

      if (Number.isNaN(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }

      const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      if (subscription.user_id !== req.user!.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const canceled = await subscriptionService.cancelSubscription(
        subscriptionId,
        cancelAtPeriodEnd !== false,
      );

      return res.json({
        id: canceled.id,
        status: canceled.status,
        cancelAtPeriodEnd: canceled.cancel_at_period_end,
        canceledAt: canceled.canceled_at,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Cancel subscription error', { error: err.message });
      return next(error);
    }
  },
);

router.post(
  '/:id/reactivate',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const subscriptionId = parseInt(req.params.id, 10);

      if (Number.isNaN(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscription ID' });
      }

      const subscription = await subscriptionRepository.getSubscriptionById(subscriptionId);

      if (!subscription) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // Verify ownership
      if (subscription.user_id !== req.user!.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const reactivated = await subscriptionService.reactivateSubscription(subscriptionId);

      return res.json({
        id: reactivated.id,
        status: reactivated.status,
        cancelAtPeriodEnd: reactivated.cancel_at_period_end,
      });
    } catch (error) {
      const err = error as Error;
      logger.error('Reactivate subscription error', { error: err.message });
      return next(error);
    }
  },
);

export default router;
