import api from './api';

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
}

export interface Subscription {
  id: number;
  productType: 'flight_tracking' | 'efb' | 'api';
  tierName: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing' | 'paused';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  createdAt: string;
}

export interface SubscriptionDetail extends Subscription {
  invoices: Invoice[];
}

export interface Invoice {
  id: number;
  amount: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  createdAt: string;
}

export interface CreateCheckoutSessionRequest {
  productType: 'flight_tracking' | 'efb' | 'api';
  tierName: string;
  priceId: string;
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession(
  data: CreateCheckoutSessionRequest,
): Promise<CheckoutSessionResponse> {
  const response = await api.post<CheckoutSessionResponse>('/api/stripe/checkout', data);
  return response.data;
}

/**
 * Get all subscriptions for the current user
 */
export async function getSubscriptions(): Promise<Subscription[]> {
  const response = await api.get<{ subscriptions: Subscription[] }>('/api/subscriptions');
  return response.data.subscriptions;
}

/**
 * Get subscription by ID
 */
export async function getSubscription(id: number): Promise<SubscriptionDetail> {
  const response = await api.get<SubscriptionDetail>(`/api/subscriptions/${id}`);
  return response.data;
}

/**
 * Cancel a subscription
 */
export async function cancelSubscription(
  id: number,
  cancelAtPeriodEnd: boolean = true,
): Promise<Subscription> {
  const response = await api.post<Subscription>(`/api/subscriptions/${id}/cancel`, {
    cancelAtPeriodEnd,
  });
  return response.data;
}

/**
 * Reactivate a canceled subscription
 */
export async function reactivateSubscription(id: number): Promise<Subscription> {
  const response = await api.post<Subscription>(`/api/subscriptions/${id}/reactivate`);
  return response.data;
}

/**
 * Get Customer Portal URL
 */
export async function getPortalUrl(returnUrl: string): Promise<string> {
  const response = await api.post<{ url: string }>('/api/stripe/portal', { returnUrl });
  return response.data.url;
}

