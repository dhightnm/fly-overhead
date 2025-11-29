import subscriptionService from '../SubscriptionService';
import subscriptionRepository from '../../repositories/SubscriptionRepository';
import postgresRepository from '../../repositories/PostgresRepository';
import stripeService from '../StripeService';
import type { Subscription } from '../../types/database.types';

jest.mock('../../repositories/SubscriptionRepository');
jest.mock('../../repositories/PostgresRepository');
jest.mock('../StripeService', () => ({
  cancelSubscription: jest.fn(),
  reactivateSubscription: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('SubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mocks
    (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([]);
    (postgresRepository.updateUserSubscriptionFlags as jest.Mock).mockResolvedValue(undefined);
  });

  describe('createSubscriptionFromStripe', () => {
    it('should create subscription from Stripe subscription object', async () => {
      const mockStripeSubscription = {
        id: 'sub_test123',
        customer: 'cus_test123',
        status: 'active',
        items: {
          data: [{
            price: {
              id: 'price_test123',
            },
          }],
        },
        metadata: {
          product_type: 'efb',
          tier_name: 'Basic',
        },
        current_period_start: 1000000000,
        current_period_end: 1000003600,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
      };

      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test123',
        stripe_subscription_id: 'sub_test123',
        stripe_price_id: 'price_test123',
        product_type: 'efb',
        tier_name: 'Basic',
        status: 'active',
        current_period_start: new Date(1000000000 * 1000),
        current_period_end: new Date(1000003600 * 1000),
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: { product_type: 'efb', tier_name: 'Basic' },
        created_at: new Date(),
        updated_at: new Date(),
      };

      (subscriptionRepository.createSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      const subscription = await subscriptionService.createSubscriptionFromStripe(
        mockStripeSubscription as any,
        1,
      );

      expect(subscription.id).toBe(1);
      expect(subscription.product_type).toBe('efb');
      expect(subscription.tier_name).toBe('Basic');
      expect(subscriptionRepository.createSubscription).toHaveBeenCalled();
      expect(subscriptionRepository.getActiveUserSubscriptions).toHaveBeenCalledWith(1);
      expect(postgresRepository.updateUserSubscriptionFlags).toHaveBeenCalled();
    });

    it('should handle string customer ID', async () => {
      const mockStripeSubscription = {
        id: 'sub_test123',
        customer: 'cus_test123',
        status: 'active',
        items: {
          data: [{
            price: 'price_test123',
          }],
        },
        metadata: {
          product_type: 'api',
          tier_name: 'Starter',
        },
        current_period_start: 1000000000,
        current_period_end: 1000003600,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
      };

      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test123',
        stripe_subscription_id: 'sub_test123',
        stripe_price_id: 'price_test123',
        product_type: 'api',
        tier_name: 'Starter',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      (subscriptionRepository.createSubscription as jest.Mock).mockResolvedValue(mockSubscription);

      await subscriptionService.createSubscriptionFromStripe(mockStripeSubscription as any, 1);

      expect(subscriptionRepository.createSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          stripe_customer_id: 'cus_test123',
          product_type: 'api',
          tier_name: 'Starter',
        }),
      );
    });
  });

  describe('updateSubscriptionFromStripe', () => {
    it('should update subscription from Stripe subscription object', async () => {
      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_test',
        stripe_price_id: 'price_test',
        product_type: 'efb',
        tier_name: 'Basic',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        cancel_at_period_end: false,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockStripeSubscription = {
        id: 'sub_test',
        customer: 'cus_test',
        status: 'canceled',
        items: {
          data: [{
            price: {
              id: 'price_test',
            },
          }],
        },
        metadata: {
          product_type: 'efb',
          tier_name: 'Basic',
        },
        current_period_start: 1000000000,
        current_period_end: 1000003600,
        cancel_at_period_end: true,
        canceled_at: 1000001800,
        trial_start: null,
        trial_end: null,
      };

      const updatedSubscription = {
        ...mockSubscription,
        status: 'canceled' as const,
        cancel_at_period_end: true,
      };

      (subscriptionRepository.getSubscriptionByStripeId as jest.Mock).mockResolvedValue(mockSubscription);
      (subscriptionRepository.updateSubscription as jest.Mock).mockResolvedValue(updatedSubscription);
      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([mockSubscription]);
      (postgresRepository.updateUserSubscriptionFlags as jest.Mock).mockResolvedValue(undefined);

      const result = await subscriptionService.updateSubscriptionFromStripe(
        mockStripeSubscription as any,
      );

      expect(result.status).toBe('canceled');
      expect(subscriptionRepository.updateSubscription).toHaveBeenCalled();
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription', async () => {
      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_test',
        stripe_price_id: 'price_test',
        product_type: 'efb',
        tier_name: 'Basic',
        status: 'active',
        current_period_start: new Date(),
        current_period_end: new Date(),
        cancel_at_period_end: true,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        metadata: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockStripeSubscription = {
        id: 'sub_test',
        status: 'active',
        cancel_at_period_end: true,
      };

      (subscriptionRepository.getSubscriptionById as jest.Mock).mockResolvedValue(mockSubscription);
      (stripeService.cancelSubscription as jest.Mock).mockResolvedValue(mockStripeSubscription);
      (subscriptionRepository.getSubscriptionByStripeId as jest.Mock).mockResolvedValue(mockSubscription);
      (subscriptionRepository.updateSubscription as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        cancel_at_period_end: true,
      });
      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([mockSubscription]);
      (postgresRepository.updateUserSubscriptionFlags as jest.Mock).mockResolvedValue(undefined);

      const result = await subscriptionService.cancelSubscription(1, true);

      expect(result.cancel_at_period_end).toBe(true);
      expect(subscriptionRepository.updateSubscription).toHaveBeenCalled();
    });
  });

  describe('syncUserFlags', () => {
    it('should sync user flags based on active subscriptions', async () => {
      const mockSubscriptions: Subscription[] = [
        {
          id: 1,
          user_id: 1,
          stripe_customer_id: 'cus_test',
          stripe_subscription_id: 'sub_test1',
          stripe_price_id: 'price_test1',
          product_type: 'flight_tracking',
          tier_name: 'Professional',
          status: 'active',
          current_period_start: new Date(),
          current_period_end: new Date(),
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          metadata: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          user_id: 1,
          stripe_customer_id: 'cus_test',
          stripe_subscription_id: 'sub_test2',
          stripe_price_id: 'price_test2',
          product_type: 'efb',
          tier_name: 'Basic',
          status: 'active',
          current_period_start: new Date(),
          current_period_end: new Date(),
          cancel_at_period_end: false,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          metadata: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue(mockSubscriptions);
      (postgresRepository.updateUserSubscriptionFlags as jest.Mock).mockResolvedValue(undefined);

      await subscriptionService.syncUserFlags(1);

      expect(postgresRepository.updateUserSubscriptionFlags).toHaveBeenCalledWith(1, {
        is_premium: true,
        is_efb: true,
        is_api: false,
      });
    });
  });
});
