import logger from '../utils/logger';
import subscriptionRepository from '../repositories/SubscriptionRepository';
import postgresRepository from '../repositories/PostgresRepository';

class UserSubscriptionService {
  async calculateUserFlags(userId: number): Promise<{
    isPremium: boolean;
    isEFB: boolean;
    isAPI: boolean;
  }> {
    let activeSubscriptions = [];
    try {
      activeSubscriptions = await subscriptionRepository.getActiveUserSubscriptions(userId);
    } catch (error) {
      logger.warn('Failed to get active subscriptions for user flags calculation', {
        error: (error as Error).message,
        userId,
      });
      return {
        isPremium: false,
        isEFB: false,
        isAPI: false,
      };
    }

    const flags = {
      isPremium: false,
      isEFB: false,
      isAPI: false,
    };

    for (const subscription of activeSubscriptions) {
      if (subscription.product_type === 'flight_tracking') {
        const tierLower = subscription.tier_name.toLowerCase();
        if (tierLower === 'professional' || tierLower === 'enterprise') {
          flags.isPremium = true;
        }
      } else if (subscription.product_type === 'efb') {
        flags.isEFB = true;
      } else if (subscription.product_type === 'api') {
        const tierLower = subscription.tier_name.toLowerCase();
        if (['starter', 'professional', 'enterprise'].includes(tierLower)) {
          flags.isAPI = true;
        }
      }
    }

    logger.debug('Calculated user flags', {
      userId,
      flags,
      activeSubscriptionsCount: activeSubscriptions.length,
    });

    return flags;
  }

  async syncUserFlags(userId: number): Promise<void> {
    const flags = await this.calculateUserFlags(userId);
    await postgresRepository.updateUserSubscriptionFlags(userId, {
      is_premium: flags.isPremium,
      is_efb: flags.isEFB,
      is_api: flags.isAPI,
    });
  }

  async getUserWithFlags(userId: number) {
    const user = await postgresRepository.getUserById(userId);
    if (!user) {
      return null;
    }

    const calculatedFlags = await this.calculateUserFlags(userId);

    return {
      ...user,
      is_premium: calculatedFlags.isPremium || user.is_premium,
      is_efb: calculatedFlags.isEFB,
      is_api: calculatedFlags.isAPI,
    };
  }
}

export default new UserSubscriptionService();
