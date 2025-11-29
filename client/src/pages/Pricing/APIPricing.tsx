import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { createCheckoutSession } from '../../services/stripe.service';
import { getTierConfig, isCustomPricingTier } from '../../utils/stripePricing';
import './Pricing.css';

interface APITier {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  rateLimit: string;
  requestsPerMonth: string;
  features: string[];
  highlight?: boolean;
  popular?: boolean;
}

const apiTiers: APITier[] = [
  {
    id: 'api-free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for testing and small projects',
    rateLimit: '100 requests/day',
    requestsPerMonth: '3,000',
    features: [
      'Real-time aircraft data',
      'Basic search endpoints',
      'Community support',
      'Standard response times',
      'Public API documentation',
      'JSON responses only',
    ],
  },
  {
    id: 'api-starter',
    name: 'Starter',
    price: '$19',
    period: 'month',
    description: 'For small applications and startups',
    rateLimit: '1,000 requests/day',
    requestsPerMonth: '30,000',
    features: [
      'Everything in Free',
      'Historical flight data',
      'Advanced search filters',
      'Email support',
      'Rate limit monitoring',
      'Webhook subscriptions (5)',
      'Priority response times',
    ],
  },
  {
    id: 'api-professional',
    name: 'Professional',
    price: '$79',
    period: 'month',
    description: 'For production applications and growing businesses',
    rateLimit: '10,000 requests/day',
    requestsPerMonth: '300,000',
    features: [
      'Everything in Starter',
      'Unlimited webhook subscriptions',
      'Custom rate limits',
      'Priority support',
      'SLA guarantees (99.9%)',
      'Advanced analytics',
      'Dedicated support channel',
    ],
    popular: true,
  },
  {
    id: 'api-enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'pricing',
    description: 'For high-volume applications and enterprise needs',
    rateLimit: 'Unlimited',
    requestsPerMonth: 'Unlimited',
    features: [
      'Everything in Professional',
      'Unlimited API requests',
      'Custom SLA guarantees',
      'On-premise deployment options',
      'Custom integrations',
      'Account manager',
      '24/7 priority support',
      'Custom data retention',
      'White-label options',
    ],
    highlight: true,
  },
];

const APIPricing: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelectTier = async (tierId: string) => {
    if (tierId === 'api-free') {
      if (!isAuthenticated) {
        window.location.href = '/';
        return;
      }
      return;
    }

    if (isCustomPricingTier(tierId)) {
      alert('Please contact sales for enterprise pricing: sales@flyoverhead.com');
      return;
    }

    if (!isAuthenticated) {
      alert('Please sign in to continue with checkout');
      history.push('/');
      return;
    }

    const config = getTierConfig(tierId);
    if (!config || !config.priceId) {
      alert('This plan is not available yet. Please contact support.');
      return;
    }

    try {
      setLoading(tierId);
      const { url } = await createCheckoutSession({
        productType: config.productType,
        tierName: config.tierName,
        priceId: config.priceId,
      });
      
      window.location.href = url;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Failed to start checkout. Please try again.');
      setLoading(null);
    }
  };

  return (
    <div className="pricing-page">
      <div className="pricing-hero">
        <div className="pricing-hero-content">
          <h1 className="pricing-title">API Pricing</h1>
          <p className="pricing-subtitle">
            Developer API access with competitive rate limits and pricing
          </p>
        </div>
      </div>

      <div className="pricing-container">
        <div className="pricing-grid">
          {apiTiers.map((tier) => (
            <div key={tier.id} className={`pricing-card ${tier.popular ? 'popular' : ''} ${tier.highlight ? 'enterprise' : ''}`}>
              <div className="pricing-card-header">
                {tier.popular && (
                  <div className="pricing-badge popular">Most Popular</div>
                )}
                {tier.highlight && (
                  <div className="pricing-badge enterprise">Enterprise</div>
                )}
                <h2 className="pricing-tier-name">{tier.name}</h2>
                <p className="pricing-tier-description">{tier.description}</p>
              </div>

              <div className="pricing-card-pricing">
                <div className="pricing-price">
                  <span className="pricing-amount">{tier.price}</span>
                  {tier.period !== 'forever' && tier.period !== 'pricing' && (
                    <span className="pricing-period">/{tier.period}</span>
                  )}
                </div>
                {tier.period === 'forever' && (
                  <span className="pricing-period">Free forever</span>
                )}
                {tier.period === 'pricing' && (
                  <span className="pricing-period">Contact us for pricing</span>
                )}
              </div>

              <div className="pricing-card-rate-limits">
                <div className="rate-limit-item">
                  <span className="rate-limit-label">Rate Limit:</span>
                  <span className="rate-limit-value">{tier.rateLimit}</span>
                </div>
                <div className="rate-limit-item">
                  <span className="rate-limit-label">Monthly Requests:</span>
                  <span className="rate-limit-value">{tier.requestsPerMonth}</span>
                </div>
              </div>

              <div className="pricing-card-features">
                <ul className="pricing-features-list">
                  {tier.features.map((feature, idx) => (
                    <li key={idx} className="pricing-feature-item">
                      <span className="pricing-feature-icon">✓</span>
                      <span className="pricing-feature-text">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                className={`pricing-card-button ${tier.popular ? 'popular' : ''} ${tier.highlight ? 'enterprise' : ''}`}
                onClick={() => handleSelectTier(tier.id)}
                disabled={loading === tier.id}
              >
                {loading === tier.id ? 'Loading...' : tier.id === 'api-free' ? 'Get Started' : tier.id === 'api-enterprise' ? 'Contact Sales' : 'Select Plan'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="pricing-footer">
        <div className="pricing-footer-content">
          <h2>Questions about API pricing?</h2>
          <p>Contact our sales team to discuss custom plans and enterprise solutions.</p>
          <button className="pricing-footer-button" onClick={() => history.push('/tiers')}>
            View All Plans
          </button>
        </div>
      </div>
    </div>
  );
};

export default APIPricing;

