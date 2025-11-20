import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import type { User } from '../../types';
import './AccountOverview.css';

interface AccountOverviewProps {
  user: User | null;
  stats?: {
    totalAircraft: number;
    activeFeeders: number;
    totalApiKeys: number;
  };
}

const AccountOverview: React.FC<AccountOverviewProps> = ({ user, stats }) => {
  const { isPremium } = useAuth();

  if (!user) {
    return (
      <div className="account-overview-card portal-card">
        <div className="loading-state">Loading account information...</div>
      </div>
    );
  }

  return (
    <div className="account-overview-card portal-card">
      <div className="account-header">
        <div className="account-avatar">
          {user.name ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'U'}
        </div>
        <div className="account-info">
          <h3>{user.name || 'User'}</h3>
          <p className="account-email">{user.email}</p>
        </div>
      </div>

      <div className="account-tier">
        <div className={`tier-badge ${isPremium() ? 'premium' : 'free'}`}>
          {isPremium() ? (
            <>
              <span className="tier-icon">⭐</span>
              <span>Premium Member</span>
            </>
          ) : (
            <>
              <span className="tier-icon">✈️</span>
              <span>Free Tier</span>
            </>
          )}
        </div>
      </div>

      {stats && (
        <div className="account-stats">
          <div className="stat-item">
            <div className="stat-value">{stats.totalAircraft}</div>
            <div className="stat-label">Aircraft Tracked</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.activeFeeders}</div>
            <div className="stat-label">Active Feeders</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.totalApiKeys}</div>
            <div className="stat-label">API Keys</div>
          </div>
        </div>
      )}

      <div className="account-features">
        <h4>Account Features</h4>
        <ul className="features-list">
          <li className={isPremium() ? 'enabled' : 'disabled'}>
            <span className="feature-icon">{isPremium() ? '✓' : '○'}</span>
            Real-time Aircraft Tracking
          </li>
          <li className={isPremium() ? 'enabled' : 'disabled'}>
            <span className="feature-icon">{isPremium() ? '✓' : '○'}</span>
            Flight Plan Routes
          </li>
          <li className={isPremium() ? 'enabled' : 'disabled'}>
            <span className="feature-icon">{isPremium() ? '✓' : '○'}</span>
            Historical Flight Data
          </li>
          <li className="coming-soon">
            <span className="feature-icon">○</span>
            3D Flight Debriefs <span className="coming-soon-badge">Coming Soon</span>
          </li>
          <li className="coming-soon">
            <span className="feature-icon">○</span>
            RightSeat AI Copilot <span className="coming-soon-badge">Coming Soon</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default AccountOverview;

