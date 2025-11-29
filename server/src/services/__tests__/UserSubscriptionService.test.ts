import userSubscriptionService from '../UserSubscriptionService';
import subscriptionRepository from '../../repositories/SubscriptionRepository';
import type { Subscription } from '../../types/database.types';

jest.mock('../../repositories/SubscriptionRepository');
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('UserSubscriptionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateUserFlags', () => {
    it('should return all flags as false when user has no subscriptions', async () => {
      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([]);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags).toEqual({
        isPremium: false,
        isEFB: false,
        isAPI: false,
      });
    });

    it('should set isPremium to true for Flight Tracking Professional subscription', async () => {
      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_test',
        stripe_price_id: 'price_test',
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
      };

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([
        mockSubscription,
      ]);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags.isPremium).toBe(true);
      expect(flags.isEFB).toBe(false);
      expect(flags.isAPI).toBe(false);
    });

    it('should set isPremium to true for Flight Tracking Enterprise subscription', async () => {
      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_test',
        stripe_price_id: 'price_test',
        product_type: 'flight_tracking',
        tier_name: 'Enterprise',
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

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([
        mockSubscription,
      ]);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags.isPremium).toBe(true);
    });

    it('should set isEFB to true for any EFB subscription', async () => {
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

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([
        mockSubscription,
      ]);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags.isEFB).toBe(true);
      expect(flags.isPremium).toBe(false);
      expect(flags.isAPI).toBe(false);
    });

    it('should set isAPI to true for API Starter subscription', async () => {
      const mockSubscription: Subscription = {
        id: 1,
        user_id: 1,
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_test',
        stripe_price_id: 'price_test',
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

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue([
        mockSubscription,
      ]);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags.isAPI).toBe(true);
      expect(flags.isPremium).toBe(false);
      expect(flags.isEFB).toBe(false);
    });

    it('should handle multiple subscriptions correctly', async () => {
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
        {
          id: 3,
          user_id: 1,
          stripe_customer_id: 'cus_test',
          stripe_subscription_id: 'sub_test3',
          stripe_price_id: 'price_test3',
          product_type: 'api',
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
      ];

      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockResolvedValue(
        mockSubscriptions,
      );

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags.isPremium).toBe(true);
      expect(flags.isEFB).toBe(true);
      expect(flags.isAPI).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      (subscriptionRepository.getActiveUserSubscriptions as jest.Mock).mockRejectedValue(
        new Error('Database error'),
      );

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags).toEqual({
        isPremium: false,
        isEFB: false,
        isAPI: false,
      });
    });
  });
});
