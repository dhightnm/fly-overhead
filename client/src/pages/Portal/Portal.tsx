import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AccountOverview from '../../components/portal/AccountOverview';
import AircraftTable from '../../components/portal/AircraftTable';
import ApiKeysSection from '../../components/portal/ApiKeysSection';
import FeederStatus from '../../components/portal/FeederStatus';
import { portalService } from '../../services/portal.service';
import type { Aircraft } from '../../types';
import type { Feeder } from '../../services/portal.service';
import './Portal.css';

const Portal: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'aircraft' | 'api-keys' | 'settings'>('dashboard');
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [feeders, setFeeders] = useState<Feeder[]>([]);
  const [stats, setStats] = useState<{
    totalAircraft: number;
    activeFeeders: number;
    totalApiKeys: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPortalData();
    }
  }, [isAuthenticated]);

  const fetchPortalData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [feedersData, aircraftData, statsData] = await Promise.all([
        portalService.getUserFeeders(),
        portalService.getUserAircraft(),
        portalService.getPortalStats(),
      ]);

      setFeeders(feedersData);
      setAircraft(aircraftData.aircraft || []);
      setStats({
        totalAircraft: statsData.totalAircraft,
        activeFeeders: statsData.activeFeeders,
        totalApiKeys: statsData.totalApiKeys,
      });
    } catch (err) {
      console.error('Error fetching portal data:', err);
      setError('Failed to load portal data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="portal-container">
        <div className="auth-required">
          <h2>Authentication Required</h2>
          <p>Please sign in to access your portal.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="portal-container">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading your portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-container">
      <div className="portal-header">
        <h1>Flight Command Center</h1>
        <p className="portal-subtitle">Your aviation hub for tracking, analysis, and flight management</p>
      </div>

      <div className="portal-nav">
        <button 
          className={`nav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <span className="nav-icon">📊</span>
          Dashboard
        </button>
        <button 
          className={`nav-tab ${activeTab === 'aircraft' ? 'active' : ''}`}
          onClick={() => setActiveTab('aircraft')}
        >
          <span className="nav-icon">✈️</span>
          Aircraft
        </button>
        <button 
          className={`nav-tab ${activeTab === 'api-keys' ? 'active' : ''}`}
          onClick={() => setActiveTab('api-keys')}
        >
          <span className="nav-icon">🔑</span>
          API Keys
        </button>
        <button 
          className={`nav-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <span className="nav-icon">⚙️</span>
          Settings
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={fetchPortalData}>Retry</button>
        </div>
      )}

      <div className="portal-content">
        {activeTab === 'dashboard' && (
          <div className="dashboard-grid">
            <AccountOverview user={user} stats={stats || undefined} />
            <FeederStatus feeders={feeders} />
            <div className="aircraft-preview">
              <AircraftTable aircraft={aircraft} compact={true} />
            </div>
          </div>
        )}
        {activeTab === 'aircraft' && (
          <AircraftTable aircraft={aircraft} compact={false} />
        )}
        {activeTab === 'api-keys' && (
          <ApiKeysSection />
        )}
        {activeTab === 'settings' && (
          <div className="settings-placeholder portal-card">
            <h2>Account Settings</h2>
            <p>Settings page coming soon. Here you'll be able to:</p>
            <ul>
              <li>Update your profile information</li>
              <li>Manage subscription and billing</li>
              <li>Configure notification preferences</li>
              <li>Export your data</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default Portal;

