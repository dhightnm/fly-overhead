import React, { useEffect, useRef, useState } from 'react';
import './Tiers.css';

interface Tier {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlight?: boolean;
  popular?: boolean;
}

const tiers: Tier[] = [
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
    ],
    highlight: true,
  },
];

interface EFBTier {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlight?: boolean;
  popular?: boolean;
}

const efbTiers: EFBTier[] = [
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
      'Terrain awareness',
      'Traffic awareness',
      'RightSeat AI Copilot (Beta)',
      'Advanced flight planning',
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
    ],
    highlight: true,
  },
];

const Tiers: React.FC = () => {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedEFBTier, setSelectedEFBTier] = useState<string | null>(null);
  const [visibleTiers, setVisibleTiers] = useState<Set<string>>(new Set());
  const tierRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const tierId = entry.target.getAttribute('data-tier-id');
            if (tierId) {
              setVisibleTiers((prev) => new Set(prev).add(tierId));
            }
          }
        });
      },
      {
        threshold: 0.3,
        rootMargin: '-50px',
      }
    );

    const currentRefs = tierRefs.current;
    currentRefs.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      currentRefs.forEach((ref) => {
        if (ref) observer.unobserve(ref);
      });
    };
  }, []);

  const handleSelectTier = (tierId: string) => {
    setSelectedTier(tierId);
    // Navigate to payment page (to be implemented)
    // For now, just log
    console.log('Selected tier:', tierId);
    // window.location.href = `/payment?tier=${tierId}`;
  };

  return (
    <div className="tiers-page">
      <div className="tiers-hero">
        <div className="tiers-hero-content">
          <h1 className="tiers-title">Choose Your Plan</h1>
          <p className="tiers-subtitle">
            Select the perfect tier for your needs. Upgrade or downgrade at any time.
          </p>
        </div>
      </div>

      <div className="tiers-container">
        {tiers.map((tier, index) => {
          const isVisible = visibleTiers.has(tier.id);
          const slideDirection = index % 2 === 0 ? 'left' : 'right';

          return (
            <div
              key={tier.id}
              ref={(el) => {
                if (el) tierRefs.current.set(tier.id, el);
              }}
              data-tier-id={tier.id}
              className={`tier-section ${isVisible ? 'visible' : ''} ${slideDirection}`}
            >
              <div className="tier-content">
                <div className="tier-header">
                  {tier.popular && (
                    <div className="tier-badge popular">Most Popular</div>
                  )}
                  {tier.highlight && (
                    <div className="tier-badge enterprise">Enterprise</div>
                  )}
                  <h2 className="tier-name">{tier.name}</h2>
                  <p className="tier-description">{tier.description}</p>
                </div>

                <div className="tier-pricing">
                  <div className="tier-price">
                    <span className="price-amount">{tier.price}</span>
                    {tier.period !== 'forever' && tier.period !== 'pricing' && (
                      <span className="price-period">/{tier.period}</span>
                    )}
                  </div>
                  {tier.period === 'forever' && (
                    <span className="price-period">Free forever</span>
                  )}
                  {tier.period === 'pricing' && (
                    <span className="price-period">Contact us for pricing</span>
                  )}
                </div>

                <div className="tier-features">
                  <h3 className="features-title">What's Included</h3>
                  <ul className="features-list">
                    {tier.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="feature-item">
                        <span className="feature-icon">✓</span>
                        <span className="feature-text">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  className={`tier-button ${tier.popular ? 'popular' : ''} ${tier.highlight ? 'enterprise' : ''}`}
                  onClick={() => handleSelectTier(tier.id)}
                >
                  {tier.id === 'free' ? 'Get Started' : tier.id === 'enterprise' ? 'Contact Sales' : 'Select Plan'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Side-by-side Comparison Section */}
      <div className="tiers-comparison-section">
        <div className="tiers-comparison-header">
          <h2 className="comparison-title">Compare Plans</h2>
          <p className="comparison-subtitle">See all features side by side</p>
        </div>
        <div className="tiers-comparison-grid">
          {tiers.map((tier) => (
            <div key={tier.id} className="comparison-tier-card">
              <div className="comparison-tier-header">
                {tier.popular && (
                  <div className="comparison-badge popular">Most Popular</div>
                )}
                {tier.highlight && (
                  <div className="comparison-badge enterprise">Enterprise</div>
                )}
                <h3 className="comparison-tier-name">{tier.name}</h3>
                <div className="comparison-tier-price">
                  <span className="comparison-price-amount">{tier.price}</span>
                  {tier.period !== 'forever' && tier.period !== 'pricing' && (
                    <span className="comparison-price-period">/{tier.period}</span>
                  )}
                </div>
                {tier.period === 'forever' && (
                  <span className="comparison-price-period">Free forever</span>
                )}
                {tier.period === 'pricing' && (
                  <span className="comparison-price-period">Contact us</span>
                )}
              </div>
              <ul className="comparison-features-list">
                {tier.features.map((feature, idx) => (
                  <li key={idx} className="comparison-feature-item">
                    <span className="comparison-feature-icon">✓</span>
                    <span className="comparison-feature-text">{feature}</span>
                  </li>
                ))}
              </ul>
              <button
                className={`comparison-tier-button ${tier.popular ? 'popular' : ''} ${tier.highlight ? 'enterprise' : ''}`}
                onClick={() => handleSelectTier(tier.id)}
              >
                {tier.id === 'free' ? 'Get Started' : tier.id === 'enterprise' ? 'Contact Sales' : 'Select Plan'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* EFB Pricing Section */}
      <div className="efb-pricing-section">
        <div className="efb-pricing-header">
          <h2 className="efb-section-title">EFB Pricing</h2>
          <p className="efb-section-subtitle">
            Electronic Flight Bag solutions with AI-powered assistance
          </p>
        </div>
        <div className="efb-tiers-container">
          {efbTiers.map((tier, index) => {
            const isVisible = visibleTiers.has(`efb-${tier.id}`);
            const slideDirection = index % 2 === 0 ? 'left' : 'right';

            return (
              <div
                key={tier.id}
                ref={(el) => {
                  if (el) tierRefs.current.set(`efb-${tier.id}`, el);
                }}
                data-tier-id={`efb-${tier.id}`}
                className={`tier-section ${isVisible ? 'visible' : ''} ${slideDirection}`}
              >
                <div className="tier-content">
                  <div className="tier-header">
                    {tier.popular && (
                      <div className="tier-badge popular">Most Popular</div>
                    )}
                    {tier.highlight && (
                      <div className="tier-badge enterprise">Enterprise</div>
                    )}
                    <h2 className="tier-name">{tier.name}</h2>
                    <p className="tier-description">{tier.description}</p>
                  </div>

                  <div className="tier-pricing">
                    <div className="tier-price">
                      <span className="price-amount">{tier.price}</span>
                      {tier.period !== 'forever' && tier.period !== 'pricing' && (
                        <span className="price-period">/{tier.period}</span>
                      )}
                    </div>
                    {tier.period === 'pricing' && (
                      <span className="price-period">Contact us for pricing</span>
                    )}
                  </div>

                  <div className="tier-features">
                    <h3 className="features-title">What's Included</h3>
                    <ul className="features-list">
                      {tier.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="feature-item">
                          <span className="feature-icon">✓</span>
                          <span className="feature-text">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <button
                    className={`tier-button ${tier.popular ? 'popular' : ''} ${tier.highlight ? 'enterprise' : ''}`}
                    onClick={() => setSelectedEFBTier(tier.id)}
                  >
                    {tier.id === 'efb-enterprise' ? 'Contact Sales' : 'Select Plan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="tiers-footer">
        <div className="tiers-footer-content">
          <h2>Ready to Get Started?</h2>
          <p>All plans include our core features. Choose the one that fits your needs.</p>
          <div className="tiers-footer-actions">
            {selectedTier && (
              <button
                className="btn-primary-large"
                onClick={() => handleSelectTier(selectedTier)}
              >
                Continue to Payment
              </button>
            )}
            {selectedEFBTier && (
              <button
                className="btn-primary-large"
                onClick={() => console.log('Selected EFB tier:', selectedEFBTier)}
              >
                Continue to EFB Payment
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tiers;

