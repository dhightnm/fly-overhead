import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSubscriptions,
  getSubscription,
  cancelSubscription,
  reactivateSubscription,
  getPortalUrl,
  type Subscription,
  type SubscriptionDetail,
} from '../../services/stripe.service';
import './Subscriptions.css';

const Subscriptions: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const history = useHistory();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubscription, setExpandedSubscription] = useState<number | null>(null);
  const [subscriptionDetails, setSubscriptionDetails] = useState<Record<number, SubscriptionDetail>>({});

  useEffect(() => {
    if (!isAuthenticated) {
      history.push('/login');
      return;
    }

    loadSubscriptions();
  }, [isAuthenticated, history]);

  const loadSubscriptions = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getSubscriptions();
      setSubscriptions(data);
    } catch (err) {
      const error = err as Error;
      setError(error.message || 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  };

  const loadSubscriptionDetails = async (id: number) => {
    if (subscriptionDetails[id]) {
      return;
    }

    try {
      const details = await getSubscription(id);
      setSubscriptionDetails((prev) => ({ ...prev, [id]: details }));
    } catch (err) {
      const error = err as Error;
      console.error('Failed to load subscription details', error);
    }
  };

  const handleExpandSubscription = (id: number) => {
    if (expandedSubscription === id) {
      setExpandedSubscription(null);
    } else {
      setExpandedSubscription(id);
      loadSubscriptionDetails(id);
    }
  };

  const handleCancelSubscription = async (id: number, cancelAtPeriodEnd: boolean) => {
    if (!window.confirm(
      cancelAtPeriodEnd
        ? 'Are you sure you want to cancel this subscription? It will remain active until the end of the current billing period.'
        : 'Are you sure you want to cancel this subscription immediately?'
    )) {
      return;
    }

    try {
      await cancelSubscription(id, cancelAtPeriodEnd);
      await loadSubscriptions();
      if (subscriptionDetails[id]) {
        await loadSubscriptionDetails(id);
      }
    } catch (err) {
      const error = err as Error;
      alert(`Failed to cancel subscription: ${error.message}`);
    }
  };

  const handleReactivateSubscription = async (id: number) => {
    try {
      await reactivateSubscription(id);
      await loadSubscriptions();
      if (subscriptionDetails[id]) {
        await loadSubscriptionDetails(id);
      }
    } catch (err) {
      const error = err as Error;
      alert(`Failed to reactivate subscription: ${error.message}`);
    }
  };

  const handleOpenPortal = async () => {
    try {
      const returnUrl = window.location.origin + '/subscriptions';
      const portalUrl = await getPortalUrl(returnUrl);
      window.location.href = portalUrl;
    } catch (err) {
      const error = err as Error;
      alert(`Failed to open customer portal: ${error.message}`);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount: number, currency: string = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const getStatusBadgeClass = (status: Subscription['status']) => {
    switch (status) {
      case 'active':
      case 'trialing':
        return 'status-badge-active';
      case 'canceled':
        return 'status-badge-canceled';
      case 'past_due':
      case 'unpaid':
        return 'status-badge-error';
      default:
        return 'status-badge-default';
    }
  };

  if (loading) {
    return (
      <div className="subscriptions-container">
        <div className="subscriptions-loading">Loading subscriptions...</div>
      </div>
    );
  }

  return (
    <div className="subscriptions-container">
      <div className="subscriptions-header">
        <h1>Subscriptions</h1>
        <button
          type="button"
          className="portal-button"
          onClick={handleOpenPortal}
        >
          Manage in Stripe Portal
        </button>
      </div>

      {error && (
        <div className="subscriptions-error">
          {error}
        </div>
      )}

      {subscriptions.length === 0 ? (
        <div className="subscriptions-empty">
          <p>You don't have any active subscriptions.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => history.push('/tiers')}
          >
            View Plans
          </button>
        </div>
      ) : (
        <div className="subscriptions-list">
          {subscriptions.map((subscription) => {
            const details = subscriptionDetails[subscription.id];
            const isExpanded = expandedSubscription === subscription.id;
            const isActive = subscription.status === 'active' || subscription.status === 'trialing';
            const canCancel = isActive && !subscription.cancelAtPeriodEnd;
            const canReactivate = subscription.status === 'canceled' && subscription.cancelAtPeriodEnd;

            return (
              <div key={subscription.id} className="subscription-card">
                <div className="subscription-card-header">
                  <div className="subscription-card-title">
                    <h3>
                      {subscription.productType === 'flight_tracking' && 'Flight Tracking'}
                      {subscription.productType === 'efb' && 'EFB'}
                      {subscription.productType === 'api' && 'API'}
                      {' '}
                      {subscription.tierName}
                    </h3>
                    <span className={`status-badge ${getStatusBadgeClass(subscription.status)}`}>
                      {subscription.status}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="expand-button"
                    onClick={() => handleExpandSubscription(subscription.id)}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                </div>

                <div className="subscription-card-body">
                  <div className="subscription-info">
                    <div className="subscription-info-item">
                      <span className="info-label">Current Period:</span>
                      <span className="info-value">
                        {formatDate(subscription.currentPeriodStart)}
                        {' '}
                        -
                        {' '}
                        {formatDate(subscription.currentPeriodEnd)}
                      </span>
                    </div>
                    {subscription.trialEnd && (
                      <div className="subscription-info-item">
                        <span className="info-label">Trial Ends:</span>
                        <span className="info-value">{formatDate(subscription.trialEnd)}</span>
                      </div>
                    )}
                    {subscription.cancelAtPeriodEnd && (
                      <div className="subscription-info-item">
                        <span className="info-label">Cancels:</span>
                        <span className="info-value">{formatDate(subscription.currentPeriodEnd)}</span>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="subscription-details">
                      {details && details.invoices && details.invoices.length > 0 && (
                        <div className="invoices-section">
                          <h4>Invoices</h4>
                          <div className="invoices-list">
                            {details.invoices.map((invoice) => (
                              <div key={invoice.id} className="invoice-item">
                                <div className="invoice-info">
                                  <span className="invoice-amount">
                                    {formatCurrency(invoice.amount, invoice.currency)}
                                  </span>
                                  <span className={`invoice-status ${invoice.status}`}>
                                    {invoice.status}
                                  </span>
                                </div>
                                {invoice.periodStart && invoice.periodEnd && (
                                  <div className="invoice-period">
                                    {formatDate(invoice.periodStart)}
                                    {' '}
                                    -
                                    {' '}
                                    {formatDate(invoice.periodEnd)}
                                  </div>
                                )}
                                {invoice.hostedInvoiceUrl && (
                                  <a
                                    href={invoice.hostedInvoiceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="invoice-link"
                                  >
                                    View Invoice
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="subscription-actions">
                        {canCancel && (
                          <button
                            type="button"
                            className="cancel-button"
                            onClick={() => handleCancelSubscription(subscription.id, true)}
                          >
                            Cancel at Period End
                          </button>
                        )}
                        {canReactivate && (
                          <button
                            type="button"
                            className="reactivate-button"
                            onClick={() => handleReactivateSubscription(subscription.id)}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Subscriptions;

