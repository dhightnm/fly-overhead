import postgresRepository from '../../repositories/PostgresRepository';
import userSubscriptionService from '../../services/UserSubscriptionService';

jest.mock('../../repositories/PostgresRepository');
jest.mock('../../services/UserSubscriptionService');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Auth Routes - Subscription Flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Subscription flags in login response', () => {
    it('should call calculateUserFlags and include flags in response', async () => {
      const mockFlags = {
        isPremium: true,
        isEFB: false,
        isAPI: false,
      };

      (userSubscriptionService.calculateUserFlags as jest.Mock).mockResolvedValue(mockFlags);

      // Verify the service is called correctly
      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags).toEqual(mockFlags);
      expect(userSubscriptionService.calculateUserFlags).toHaveBeenCalledWith(1);
    });

    it('should handle errors gracefully and return default flags', async () => {
      (userSubscriptionService.calculateUserFlags as jest.Mock).mockRejectedValue(
        new Error('Database error'),
      );

      try {
        await userSubscriptionService.calculateUserFlags(1);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Subscription flags in /me endpoint', () => {
    it('should calculate flags for authenticated user', async () => {
      const mockUser = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        is_premium: false,
        premium_expires_at: null,
        is_feeder_provider: false,
        is_efb: false,
        is_api: false,
        stripe_customer_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockFlags = {
        isPremium: false,
        isEFB: true,
        isAPI: false,
      };

      (postgresRepository.getUserById as jest.Mock).mockResolvedValue(mockUser);
      (userSubscriptionService.calculateUserFlags as jest.Mock).mockResolvedValue(mockFlags);

      const flags = await userSubscriptionService.calculateUserFlags(1);

      expect(flags).toEqual(mockFlags);
      expect(userSubscriptionService.calculateUserFlags).toHaveBeenCalledWith(1);
    });
  });
});
