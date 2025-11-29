/**
 * Stripe pricing configuration and tier mappings
 * Maps tier IDs to product types and Stripe price IDs
 */

export interface TierConfig {
  productType: 'flight_tracking' | 'efb' | 'api';
  tierName: string;
  priceId: string | null; // null for custom/enterprise tiers
}

// Map tier IDs to their configuration
export const TIER_CONFIG: Record<string, TierConfig> = {
  // Flight Tracking tiers
  'pro': {
    productType: 'flight_tracking',
    tierName: 'Professional',
    priceId: process.env.REACT_APP_STRIPE_PRICE_FLIGHT_TRACKING_PRO || null,
  },
  'enterprise': {
    productType: 'flight_tracking',
    tierName: 'Enterprise',
    priceId: null, // Custom pricing
  },
  
  // EFB tiers
  'efb-basic': {
    productType: 'efb',
    tierName: 'Basic',
    // Fallback to hardcoded value if env var not available (for testing)
    priceId: process.env.REACT_APP_STRIPE_PRICE_EFB_BASIC || 'price_1SYfWzPEEeyv6ZMx9aJnzPdD',
  },
  'efb-pro': {
    productType: 'efb',
    tierName: 'Professional',
    priceId: process.env.REACT_APP_STRIPE_PRICE_EFB_PRO || null,
  },
  'efb-enterprise': {
    productType: 'efb',
    tierName: 'Enterprise',
    priceId: null, // Custom pricing
  },
  
  // API tiers
  'api-starter': {
    productType: 'api',
    tierName: 'Starter',
    priceId: process.env.REACT_APP_STRIPE_PRICE_API_STARTER || null,
  },
  'api-professional': {
    productType: 'api',
    tierName: 'Professional',
    priceId: process.env.REACT_APP_STRIPE_PRICE_API_PRO || null,
  },
  'api-enterprise': {
    productType: 'api',
    tierName: 'Enterprise',
    priceId: null, // Custom pricing
  },
};

/**
 * Get tier configuration by tier ID
 */
export function getTierConfig(tierId: string): TierConfig | null {
  return TIER_CONFIG[tierId] || null;
}

/**
 * Check if a tier requires custom pricing (enterprise)
 */
export function isCustomPricingTier(tierId: string): boolean {
  // Enterprise tiers always require custom pricing
  return tierId.includes('enterprise') || tierId === 'enterprise';
}

