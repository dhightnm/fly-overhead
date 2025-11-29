import stripeService from '../StripeService';
import postgresRepository from '../../repositories/PostgresRepository';
import type { User } from '../../types/database.types';

jest.mock('../../repositories/PostgresRepository', () => ({
  updateUserStripeCustomerId: jest.fn(),
}));
jest.mock('../../config', () => ({
  database: {
    postgres: {
      url: 'postgresql://test:test@localhost:5432/test',
    },
  },
  stripe: {
    secretKey: 'sk_test_123',
    publishableKey: 'pk_test_123',
    webhookSecret: 'whsec_test',
    apiVersion: '2024-11-20.acacia',
    priceIds: {},
    successUrl: 'http://localhost:3000/success',
    cancelUrl: 'http://localhost:3000/cancel',
  },
}));
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  customers: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  checkout: {
    sessions: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  },
  billingPortal: {
    sessions: {
      create: jest.fn(),
    },
  },
})));
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('StripeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('should return true when Stripe is configured', () => {
      expect(stripeService.isConfigured()).toBe(true);
    });
  });

  describe('getOrCreateCustomer', () => {
    it('should retrieve existing customer when user has stripe_customer_id', async () => {
      const mockUser: User = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        password: null,
        google_id: null,
        picture: null,
        is_premium: false,
        premium_expires_at: null,
        is_feeder_provider: false,
        is_efb: false,
        is_api: false,
        stripe_customer_id: 'cus_existing123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockStripe = stripeService as any;
      const mockCustomer = { id: 'cus_existing123', deleted: false };
      mockStripe.stripe.customers.retrieve.mockResolvedValue(mockCustomer);

      const customer = await stripeService.getOrCreateCustomer(mockUser);

      expect(customer.id).toBe('cus_existing123');
      expect(mockStripe.stripe.customers.retrieve).toHaveBeenCalledWith('cus_existing123');
    });

    it('should create new customer when user does not have stripe_customer_id', async () => {
      const mockUser: User = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        password: null,
        google_id: null,
        picture: null,
        is_premium: false,
        premium_expires_at: null,
        is_feeder_provider: false,
        is_efb: false,
        is_api: false,
        stripe_customer_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockStripe = stripeService as any;
      const mockCustomer = { id: 'cus_new123', email: 'test@example.com' };
      mockStripe.stripe.customers.create.mockResolvedValue(mockCustomer);
      (postgresRepository.updateUserStripeCustomerId as jest.Mock).mockResolvedValue(undefined);

      const customer = await stripeService.getOrCreateCustomer(mockUser);

      expect(customer.id).toBe('cus_new123');
      expect(mockStripe.stripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        metadata: {
          user_id: '1',
        },
      });
      expect(postgresRepository.updateUserStripeCustomerId).toHaveBeenCalledWith(1, 'cus_new123');
    });

    it('should create new customer when existing customer is deleted', async () => {
      const mockUser: User = {
        id: 1,
        email: 'test@example.com',
        name: 'Test User',
        password: null,
        google_id: null,
        picture: null,
        is_premium: false,
        premium_expires_at: null,
        is_feeder_provider: false,
        is_efb: false,
        is_api: false,
        stripe_customer_id: 'cus_deleted123',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockStripe = stripeService as any;
      const deletedCustomer = { id: 'cus_deleted123', deleted: true };
      const newCustomer = { id: 'cus_new123', email: 'test@example.com' };
      mockStripe.stripe.customers.retrieve.mockResolvedValue(deletedCustomer);
      mockStripe.stripe.customers.create.mockResolvedValue(newCustomer);
      (postgresRepository.updateUserStripeCustomerId as jest.Mock).mockResolvedValue(undefined);

      const customer = await stripeService.getOrCreateCustomer(mockUser);

      expect(customer.id).toBe('cus_new123');
      expect(mockStripe.stripe.customers.create).toHaveBeenCalled();
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session with correct parameters', async () => {
      const mockStripe = stripeService as any;
      const mockSession = {
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      };
      mockStripe.stripe.checkout.sessions.create.mockResolvedValue(mockSession);

      const session = await stripeService.createCheckoutSession(
        'cus_test',
        'price_test',
        {
          userId: 1,
          productType: 'efb',
          tierName: 'Basic',
        },
      );

      expect(session.id).toBe('cs_test_123');
      expect(session.url).toBe('https://checkout.stripe.com/test');
      expect(mockStripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_test',
          line_items: [{ price: 'price_test', quantity: 1 }],
          mode: 'subscription',
          metadata: {
            user_id: '1',
            product_type: 'efb',
            tier_name: 'Basic',
          },
        }),
      );
    });
  });

  describe('createPortalSession', () => {
    it('should create a portal session with correct return URL', async () => {
      const mockStripe = stripeService as any;
      const mockSession = {
        url: 'https://billing.stripe.com/test',
      };
      mockStripe.stripe.billingPortal.sessions.create.mockResolvedValue(mockSession);

      const session = await stripeService.createPortalSession('cus_test', 'http://localhost:3000/return');

      expect(session.url).toBe('https://billing.stripe.com/test');
      expect(mockStripe.stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
        customer: 'cus_test',
        return_url: 'http://localhost:3000/return',
      });
    });
  });
});
