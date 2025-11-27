import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import './Admin.css';

interface DashboardData {
  timestamp: string;
  metrics: {
    enabled: boolean;
    rateLimits: {
      total: number;
      exceeded: number;
      byEndpoint: Record<string, { total: number; exceeded: number }>;
      bySubscriberType: Record<string, { total: number; exceeded: number }>;
    };
    circuitBreakers: {
      total: number;
      tripped: number;
      bySubscriberType: Record<string, { total: number; tripped: number }>;
    };
  };
  system: {
    cache: {
      enabled: boolean;
      hits: number;
      misses: number;
      boundsQueries: number;
      boundsResults: number;
      lastBoundsDurationMs: number | null;
    };
    liveState: {
      enabled: boolean;
      cacheSize: number;
      maxEntries: number;
      ttlSeconds: number;
    };
    queue: {
      enabled: boolean;
      queueDepth: number | null;
      delayedDepth: number | null;
      dlqDepth: number | null;
      health: string;
    };
    webhookQueue: {
      enabled: boolean;
      queueDepth: number | null;
      delayedDepth: number | null;
      dlqDepth: number | null;
      health: string;
    };
    database: {
      totalConnections: number;
    };
  };
  features: {
    backgroundJobs: boolean;
    conusPolling: boolean;
    backfill: boolean;
    metrics: boolean;
    prometheus: boolean;
  };
}

const Admin: React.FC = () => {
  const { user } = useAuth();
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  useEffect(() => {
    fetchDashboardData();
    let interval: NodeJS.Timeout | null = null;

    if (autoRefresh) {
      interval = setInterval(fetchDashboardData, refreshInterval);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, refreshInterval]);

  const fetchDashboardData = async () => {
    try {
      const response = await api.get<DashboardData>('/api/admin/dashboard');
      setDashboardData(response.data);
      setError(null);
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('Admin access required. Your email must be in DEV_KEY_ALLOWED_EMAILS.');
      } else {
        setError(err.response?.data?.error?.message || 'Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-container">
        <div className="admin-loading">
          <div className="loading-spinner"></div>
          <p>Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-container">
        <div className="admin-error">
          <h2>Access Denied</h2>
          <p>{error}</p>
          <button onClick={() => window.location.href = '/'} className="btn-primary">
            Return Home
          </button>
        </div>
      </div>
    );
  }

  if (!dashboardData) {
    return null;
  }

  const formatNumber = (num: number | null | undefined): string => {
    if (num === null || num === undefined) return 'N/A';
    return num.toLocaleString();
  };

  const formatDuration = (ms: number | null): string => {
    if (ms === null) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getHealthColor = (health: string | { status: string; createdAt?: string } | undefined): string => {
    const status = typeof health === 'string' ? health : health?.status || 'unknown';
    if (status === 'healthy' || status === 'ready') return '#10B981';
    if (status === 'degraded' || status === 'connecting' || status === 'reconnecting') return '#F59E0B';
    if (status === 'unhealthy' || status === 'error' || status === 'closed') return '#EF4444';
    if (status === 'disabled' || status === 'unknown') return '#757575';
    return '#757575';
  };

  const getHealthStatus = (health: string | { status: string; createdAt?: string } | undefined): string => {
    return typeof health === 'string' ? health : health?.status || 'unknown';
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div className="admin-header-content">
          <h1>System Administration</h1>
          <div className="admin-header-meta">
            <span className="admin-user">{user?.email}</span>
            <span className="admin-timestamp">
              {new Date(dashboardData.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
        <div className="admin-controls">
          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto Refresh</span>
          </label>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="admin-select"
          >
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
            <option value={30000}>30s</option>
          </select>
          <button onClick={fetchDashboardData} className="btn-refresh">
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="admin-grid">
        {/* Metrics Section */}
        <div className="admin-card metrics-card">
          <div className="card-header">
            <h2>Rate Limits & Circuit Breakers</h2>
            <span className={`status-badge ${dashboardData.metrics.enabled ? 'enabled' : 'disabled'}`}>
              {dashboardData.metrics.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div className="card-content">
            <div className="metrics-grid">
              <div className="metric-item">
                <div className="metric-label">Rate Limit Checks</div>
                <div className="metric-value">{formatNumber(dashboardData.metrics.rateLimits.total)}</div>
                <div className="metric-detail">
                  {formatNumber(dashboardData.metrics.rateLimits.exceeded)} exceeded
                </div>
              </div>
              <div className="metric-item">
                <div className="metric-label">Circuit Breaker Events</div>
                <div className="metric-value">{formatNumber(dashboardData.metrics.circuitBreakers.total)}</div>
                <div className="metric-detail">
                  {formatNumber(dashboardData.metrics.circuitBreakers.tripped)} tripped
                </div>
              </div>
            </div>

            {Object.keys(dashboardData.metrics.rateLimits.byEndpoint).length > 0 && (
              <div className="metrics-breakdown">
                <h3>By Endpoint</h3>
                <div className="breakdown-list">
                  {Object.entries(dashboardData.metrics.rateLimits.byEndpoint).map(([endpoint, stats]) => (
                    <div key={endpoint} className="breakdown-item">
                      <span className="breakdown-label">{endpoint}</span>
                      <span className="breakdown-value">
                        {stats.total} ({stats.exceeded} exceeded)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* System Status */}
        <div className="admin-card system-card">
          <div className="card-header">
            <h2>System Status</h2>
          </div>
          <div className="card-content">
            <div className="system-grid">
              <div className="system-item">
                <div className="system-label">Aircraft Cache</div>
                <div className="system-status">
                  <span className={`status-indicator ${dashboardData.system.cache.enabled ? 'active' : 'inactive'}`}></span>
                  {dashboardData.system.cache.enabled ? 'Enabled' : 'Disabled'}
                </div>
                <div className="system-metrics">
                  <span>Hits: {formatNumber(dashboardData.system.cache.hits)}</span>
                  <span>Misses: {formatNumber(dashboardData.system.cache.misses)}</span>
                </div>
              </div>

              <div className="system-item">
                <div className="system-label">Live State</div>
                <div className="system-status">
                  <span className={`status-indicator ${dashboardData.system.liveState.enabled ? 'active' : 'inactive'}`}></span>
                  {dashboardData.system.liveState.enabled ? 'Enabled' : 'Disabled'}
                </div>
                <div className="system-metrics">
                  <span>Size: {formatNumber(dashboardData.system.liveState.cacheSize)} / {formatNumber(dashboardData.system.liveState.maxEntries)}</span>
                </div>
              </div>

              <div className="system-item">
                <div className="system-label">Aircraft Queue</div>
                <div className="system-status">
                  <span className={`status-indicator ${dashboardData.system.queue.enabled ? 'active' : 'inactive'}`}></span>
                  {dashboardData.system.queue.enabled ? 'Enabled' : 'Disabled'}
                </div>
                <div className="system-metrics">
                  <span>Depth: {formatNumber(dashboardData.system.queue.queueDepth)}</span>
                  <span>DLQ: {formatNumber(dashboardData.system.queue.dlqDepth)}</span>
                </div>
                <div className="system-health" style={{ color: getHealthColor(dashboardData.system.queue.health) }}>
                  {getHealthStatus(dashboardData.system.queue.health)}
                </div>
              </div>

              <div className="system-item">
                <div className="system-label">Webhook Queue</div>
                <div className="system-status">
                  <span className={`status-indicator ${dashboardData.system.webhookQueue.enabled ? 'active' : 'inactive'}`}></span>
                  {dashboardData.system.webhookQueue.enabled ? 'Enabled' : 'Disabled'}
                </div>
                <div className="system-metrics">
                  <span>Depth: {formatNumber(dashboardData.system.webhookQueue.queueDepth)}</span>
                  <span>DLQ: {formatNumber(dashboardData.system.webhookQueue.dlqDepth)}</span>
                </div>
                <div className="system-health" style={{ color: getHealthColor(dashboardData.system.webhookQueue.health) }}>
                  {getHealthStatus(dashboardData.system.webhookQueue.health)}
                </div>
              </div>

              <div className="system-item">
                <div className="system-label">Database</div>
                <div className="system-status">
                  <span className="status-indicator active"></span>
                  Connected
                </div>
                <div className="system-metrics">
                  <span>Connections: {formatNumber(dashboardData.system.database.totalConnections)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="admin-card features-card">
          <div className="card-header">
            <h2>Feature Flags</h2>
          </div>
          <div className="card-content">
            <div className="features-list">
              {Object.entries(dashboardData.features).map(([key, value]) => (
                <div key={key} className="feature-item">
                  <span className="feature-name">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  <span className={`feature-status ${value ? 'enabled' : 'disabled'}`}>
                    {value ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cache Performance */}
        {dashboardData.system.cache.enabled && (
          <div className="admin-card performance-card">
            <div className="card-header">
              <h2>Cache Performance</h2>
            </div>
            <div className="card-content">
              <div className="performance-grid">
                <div className="performance-item">
                  <div className="performance-label">Cache Hit Rate</div>
                  <div className="performance-value">
                    {dashboardData.system.cache.hits + dashboardData.system.cache.misses > 0
                      ? ((dashboardData.system.cache.hits / (dashboardData.system.cache.hits + dashboardData.system.cache.misses)) * 100).toFixed(1)
                      : '0'}%
                  </div>
                </div>
                <div className="performance-item">
                  <div className="performance-label">Bounds Queries</div>
                  <div className="performance-value">{formatNumber(dashboardData.system.cache.boundsQueries)}</div>
                </div>
                <div className="performance-item">
                  <div className="performance-label">Last Query Duration</div>
                  <div className="performance-value">{formatDuration(dashboardData.system.cache.lastBoundsDurationMs)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;

