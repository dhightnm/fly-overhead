import React from 'react';
import type { Feeder } from '../../services/portal.service';
import './FeederStatus.css';

interface FeederStatusProps {
  feeders: Feeder[];
}

const FeederStatus: React.FC<FeederStatusProps> = ({ feeders }) => {
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return <span className="status-badge active">Active</span>;
      case 'inactive':
        return <span className="status-badge inactive">Inactive</span>;
      case 'suspended':
        return <span className="status-badge suspended">Suspended</span>;
      default:
        return <span className="status-badge unknown">{status}</span>;
    }
  };

  const getLastSeenText = (lastSeen: string | null) => {
    if (!lastSeen) return 'Never';
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - lastSeenDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const isFeederHealthy = (feeder: Feeder) => {
    if (!feeder.last_seen_at) return false;
    const lastSeen = new Date(feeder.last_seen_at);
    const now = new Date();
    const diffHours = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60);
    return diffHours < 24; // Healthy if seen in last 24 hours
  };

  const onlineCount = feeders.filter((f) => f.status?.toLowerCase() === 'active' && isFeederHealthy(f)).length;
  const totalCount = feeders.length;

  return (
    <div className="feeders-page">
      <div className="feeders-header">
        <div className="feeders-header-content">
          <h1>My Feeders</h1>
          <p className="feeders-subtitle">Manage and monitor your aircraft data feeders</p>
        </div>
        <div className="feeders-stats">
          <div className="stat-box">
            <span className="stat-value">{totalCount}</span>
            <span className="stat-label">Total Feeders</span>
          </div>
          <div className="stat-box">
            <span className="stat-value">{onlineCount}</span>
            <span className="stat-label">Online</span>
          </div>
        </div>
      </div>

      <div className="feeder-status-card portal-card">
        <div className="section-header">
          <h2>Feeders</h2>
          <span className="feeder-count">{feeders.length} feeder{feeders.length !== 1 ? 's' : ''}</span>
        </div>

        {feeders.length === 0 ? (
          <div className="empty-state">
            <p>No feeders registered. Register a feeder to start tracking aircraft.</p>
          </div>
        ) : (
          <div className="feeders-list">
            {feeders.map((feeder) => (
              <div key={feeder.feeder_id} className="feeder-card">
                <div className="feeder-header">
                  <div className="feeder-info">
                    <h3>{feeder.name || feeder.feeder_id}</h3>
                    <code className="feeder-id">{feeder.feeder_id}</code>
                  </div>
                  <div className="feeder-status">
                    {getStatusBadge(feeder.status)}
                    {isFeederHealthy(feeder) && (
                      <span className="health-indicator healthy">✓ Healthy</span>
                    )}
                  </div>
                </div>

                <div className="feeder-details">
                  <div className="feeder-detail-row">
                    <span className="feeder-label">Last Seen:</span>
                    <span className="feeder-value">{getLastSeenText(feeder.last_seen_at)}</span>
                  </div>
                  {feeder.latitude && feeder.longitude && (
                    <div className="feeder-detail-row">
                      <span className="feeder-label">Location:</span>
                      <span className="feeder-value">
                        {feeder.latitude.toFixed(4)}, {feeder.longitude.toFixed(4)}
                      </span>
                    </div>
                  )}
                  <div className="feeder-detail-row">
                    <span className="feeder-label">Registered:</span>
                    <span className="feeder-value">
                      {new Date(feeder.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeederStatus;

