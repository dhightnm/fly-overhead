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

const efbTiers: PricingTier[] = [
  {
    id: 'efb-basic',
    name: 'EFB Basic',
    price: '$49',
    period: 'month',
    description: 'Essential EFB features for general aviation',
    features: [
      'Flight planning tools',
      'Weather integration',
      'Basic charts',
      'Flight logbook',
      'Route optimization',
      'Basic terrain awareness',
    ],
  },
  {
    id: 'efb-pro',
    name: 'EFB Professional',
    price: '$99',
    period: 'month',
    description: 'Advanced features for professional pilots',
    features: [
      'Everything in Basic',
      'Advanced weather radar',
      'IFR/VFR charts',
      'Enhanced terrain awareness',
      'Traffic awareness',
      'RightSeat AI Copilot (Beta)',
      'Advanced flight planning',
      'Custom checklists',
      'Flight debriefing tools',
    ],
    popular: true,
  },
  {
    id: 'efb-enterprise',
    name: 'EFB Enterprise',
    price: 'Custom',
    period: 'pricing',
    description: 'Full-featured EFB with AI-powered RightSeat copilot',
    features: [
      'Everything in Professional',
      'AI-powered RightSeat Copilot',
      'Real-time flight assistance',
      'Automated checklists',
      'Custom integrations',
      'Priority support',
      'Fleet management',
      'Custom training',
      'Dedicated account manager',
    ],
    highlight: true,
  },
];

const EFBPricing: React.FC = () => {
  const history = useHistory();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelectTier = async (tierId: string) => {
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
    if (!config) {
      console.error('Tier config not found for:', tierId);
      alert('This plan is not available yet. Please contact support.');
      return;
    }

    if (!config.priceId) {
      console.error('Price ID not found for tier:', tierId, 'Config:', config);
      alert(`This plan (${config.tierName}) is not available yet. The Stripe price ID needs to be configured. Please contact support.`);
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
          <h1 className="pricing-title">EFB Pricing</h1>
          <p className="pricing-subtitle">
            Electronic Flight Bag solutions with AI-powered assistance
          </p>
        </div>
      </div>

      <div className="pricing-container">
        <div className="pricing-grid">
          {efbTiers.map((tier) => (
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
                {loading === tier.id ? 'Loading...' : tier.id === 'efb-enterprise' ? 'Contact Sales' : 'Select Plan'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="pricing-footer">
        <div className="pricing-footer-content">
          <h2>Questions about EFB pricing?</h2>
          <p>Contact our sales team to discuss custom plans and enterprise solutions.</p>
          <button className="pricing-footer-button" onClick={() => history.push('/tiers')}>
            View All Plans
          </button>
        </div>
      </div>
    </div>
  );
};

export default EFBPricing;

