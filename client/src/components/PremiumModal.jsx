import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './PremiumModal.css';

const PremiumModal = ({ isOpen, onClose, onSignup }) => {
  const { isAuthenticated } = useAuth();

  if (!isOpen) return null;

  const features = [
    'Advanced flight route visualization',
    'Historical flight data access',
    'Extended search capabilities',
    'Priority API access',
    'Ad-free experience',
    'Real-time weather overlays',
    'Custom alerts and notifications',
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="premium-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <div className="premium-header">
          <div className="premium-badge">⭐ Premium</div>
          <h2>Unlock Premium Features</h2>
          <p className="premium-subtitle">Get access to advanced aircraft tracking features</p>
        </div>

        <div className="premium-features">
          <h3>What's Included:</h3>
          <ul>
            {features.map((feature, index) => (
              <li key={index}>
                <span className="check-icon">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        <div className="premium-pricing">
          <div className="price-card">
            <div className="price-amount">$9.99</div>
            <div className="price-period">per month</div>
          </div>
        </div>

        {!isAuthenticated ? (
          <div className="premium-cta">
            <p className="cta-text">Sign up to get started</p>
            <button className="btn-primary" onClick={() => { onClose(); if (onSignup) onSignup(); }}>
              Sign Up Free
            </button>
          </div>
        ) : (
          <div className="premium-cta">
            <button className="btn-primary btn-premium">
              Upgrade to Premium
            </button>
            <p className="premium-note">Billing starts immediately. Cancel anytime.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PremiumModal;

