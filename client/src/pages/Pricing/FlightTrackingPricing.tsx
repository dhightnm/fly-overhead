import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { createCheckoutSession } from '../../services/stripe.service';
import { getTierConfig, isCustomPricingTier } from '../../utils/stripePricing';
import './Pricing.css';

interface PricingTier {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlight?: boolean;
  popular?: boolean;
}

const flightTrackingTiers: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Perfect for casual aircraft tracking and exploration',
    features: [
      'Real-time aircraft tracking',
      'Basic search functionality',
      'Public API access (limited)',
      'Community support',
      'Up to 100 API requests/day',
      'Basic map visualization',
    ],
  },
  {
    id: 'pro',
    name: 'Professional',
    price: '$29',
    period: 'month',
    description: 'For developers and aviation enthusiasts who need more',
    features: [
      'Everything in Free',
      '10,000 API requests/day',
      'Priority API access',
      'Historical flight data',
      'Advanced search filters',
      'Webhook subscriptions',
      'Email support',
      'Rate limit monitoring',
      'Enhanced map features',
    ],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'pricing',
    description: 'For organizations requiring high-volume access and dedicated support',
    features: [
      'Everything in Professional',
      'Unlimited API requests',
      'Dedicated support channel',
      'Custom rate limits',
      'SLA guarantees',
      'On-premise deployment options',
      'Custom integrations',
      'Account manager',
      'Advanced analytics',
    ],
    highlight: true,
  },
];

const FlightTrackingPricing: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelectTier = async (tierId: string) => {
    if (tierId === 'free') {
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
          <h1 className="pricing-title">Flight Tracking Pricing</h1>
          <p className="pricing-subtitle">
            Real-time aircraft tracking and comprehensive flight data access
          </p>
        </div>
      </div>

      <div className="pricing-container">
        <div className="pricing-grid">
          {flightTrackingTiers.map((tier) => (
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
                {loading === tier.id ? 'Loading...' : tier.id === 'free' ? 'Get Started' : tier.id === 'enterprise' ? 'Contact Sales' : 'Select Plan'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="pricing-footer">
        <div className="pricing-footer-content">
          <h2>Questions about pricing?</h2>
          <p>Contact our sales team to discuss custom plans and enterprise solutions.</p>
          <button className="pricing-footer-button" onClick={() => history.push('/tiers')}>
            View All Plans
          </button>
        </div>
      </div>
    </div>
  );
};

export default FlightTrackingPricing;

