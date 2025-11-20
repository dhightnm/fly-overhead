import React, { useState, useEffect } from 'react';
import './ApiKeysSection.css';

interface ApiKey {
  keyId: string;
  name: string;
  description: string | null;
  prefix: string;
  type: 'development' | 'production';
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  expiresAt: string | null;
}

const ApiKeysSection: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [newKeyType, setNewKeyType] = useState<'development' | 'production'>('development');

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/keys', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const data = await response.json();
      setApiKeys(data.keys || []);
    } catch (error) {
      console.error('Error fetching API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    try {
      const response = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          name: newKeyName,
          description: newKeyDescription,
          type: newKeyType,
          scopes: ['read'],
        }),
      });

      const data = await response.json();
      
      if (response.ok && data.key) {
        // Show the key to the user (they need to copy it)
        window.alert(`API Key created! Save this key now - it won't be shown again:\n\n${data.key}`);
        setShowCreateModal(false);
        setNewKeyName('');
        setNewKeyDescription('');
        fetchApiKeys();
      } else {
        window.alert('Error creating API key: ' + (data.error?.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error creating API key:', error);
      window.alert('Error creating API key');
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!window.confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/keys/${keyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (response.ok) {
        fetchApiKeys();
      } else {
        window.alert('Error revoking API key');
      }
    } catch (error) {
      console.error('Error revoking API key:', error);
      window.alert('Error revoking API key');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="api-keys-section portal-card">
      <div className="section-header">
        <h2>API Keys</h2>
        <button 
          className="create-key-btn"
          onClick={() => setShowCreateModal(true)}
        >
          + Create New Key
        </button>
      </div>

      {loading ? (
        <div className="loading-state">Loading API keys...</div>
      ) : apiKeys.length === 0 ? (
        <div className="empty-state">
          <p>No API keys found. Create your first API key to get started.</p>
        </div>
      ) : (
        <div className="api-keys-list">
          {apiKeys.map((key) => (
            <div key={key.keyId} className="api-key-card">
              <div className="key-header">
                <div className="key-info">
                  <h3>{key.name}</h3>
                  {key.description && <p className="key-description">{key.description}</p>}
                </div>
                <div className="key-badges">
                  <span className={`key-type-badge ${key.type}`}>
                    {key.type === 'production' ? '🔴 Production' : '🟡 Development'}
                  </span>
                  <span className={`key-status-badge ${key.status}`}>
                    {key.status}
                  </span>
                </div>
              </div>

              <div className="key-details">
                <div className="key-detail-row">
                  <span className="key-label">Key ID:</span>
                  <code className="key-value">{key.keyId}</code>
                </div>
                <div className="key-detail-row">
                  <span className="key-label">Prefix:</span>
                  <code className="key-value">{key.prefix}****</code>
                </div>
                <div className="key-detail-row">
                  <span className="key-label">Scopes:</span>
                  <span className="key-value">{key.scopes.join(', ')}</span>
                </div>
                <div className="key-detail-row">
                  <span className="key-label">Created:</span>
                  <span className="key-value">{formatDate(key.createdAt)}</span>
                </div>
                {key.lastUsedAt && (
                  <div className="key-detail-row">
                    <span className="key-label">Last Used:</span>
                    <span className="key-value">{formatDate(key.lastUsedAt)}</span>
                  </div>
                )}
                {key.usageCount > 0 && (
                  <div className="key-detail-row">
                    <span className="key-label">Usage Count:</span>
                    <span className="key-value">{key.usageCount.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {key.status === 'active' && (
                <div className="key-actions">
                  <button
                    className="revoke-btn"
                    onClick={() => handleRevokeKey(key.keyId)}
                  >
                    Revoke Key
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New API Key</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production API Key"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newKeyDescription}
                  onChange={(e) => setNewKeyDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>Type *</label>
                <select
                  value={newKeyType}
                  onChange={(e) => setNewKeyType(e.target.value as 'development' | 'production')}
                >
                  <option value="development">Development</option>
                  <option value="production">Production</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="cancel-btn" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button
                className="create-btn"
                onClick={handleCreateKey}
                disabled={!newKeyName.trim()}
              >
                Create Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiKeysSection;

