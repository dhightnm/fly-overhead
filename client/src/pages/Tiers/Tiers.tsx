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

const Tiers: React.FC = () => {
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tiers;

