import React from 'react';
import { useHistory } from 'react-router-dom';
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

  const handleSelectTier = (tierId: string) => {
    console.log('Selected tier:', tierId);
    // Navigate to payment page (to be implemented)
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
              >
                {tier.id === 'efb-enterprise' ? 'Contact Sales' : 'Select Plan'}
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

