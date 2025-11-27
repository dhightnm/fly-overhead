import logger from '../utils/logger';

export interface RateLimitMetric {
  endpoint: string;
  subscriberType: string;
  subscriberId: string;
  limit: number;
  remaining: number;
  exceeded: boolean;
  timestamp: number;
}

export interface CircuitBreakerMetric {
  subscriberType: string;
  subscriberId: string;
  tripped: boolean;
  timestamp: number;
}

/**
 * Simple Metrics Service
 * Collects metrics in-memory (free, no external dependencies)
 * Can optionally export to Prometheus format if feature flag enabled
 *
 * For production, consider:
 * - Prometheus (free, open source) - requires infrastructure
 * - StatsD + Graphite (free, open source)
 * - CloudWatch (AWS) - pay per metric
 * - Datadog/New Relic - paid services
 */
class MetricsService {
  private rateLimitMetrics: RateLimitMetric[] = [];

  private circuitBreakerMetrics: CircuitBreakerMetric[] = [];

  private readonly MAX_METRICS = 10000; // Keep last 10k metrics

  private enabled: boolean = false;

  /**
   * Enable or disable metrics collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      logger.info('Metrics collection enabled');
    } else {
      logger.info('Metrics collection disabled');
    }
  }

  /**
   * Record a rate limit check
   */
  recordRateLimit(
    endpoint: string,
    subscriberType: string,
    subscriberId: string | number,
    limit: number,
    remaining: number,
    exceeded: boolean,
  ): void {
    if (!this.enabled) {
      return;
    }

    const metric: RateLimitMetric = {
      endpoint,
      subscriberType,
      subscriberId: String(subscriberId),
      limit,
      remaining,
      exceeded,
      timestamp: Date.now(),
    };

    this.rateLimitMetrics.push(metric);

    // Keep only last MAX_METRICS
    if (this.rateLimitMetrics.length > this.MAX_METRICS) {
      this.rateLimitMetrics = this.rateLimitMetrics.slice(-this.MAX_METRICS);
    }
  }

  /**
   * Record a circuit breaker event
   */
  recordCircuitBreaker(
    subscriberType: string,
    subscriberId: string | number,
    tripped: boolean,
  ): void {
    if (!this.enabled) {
      return;
    }

    const metric: CircuitBreakerMetric = {
      subscriberType,
      subscriberId: String(subscriberId),
      tripped,
      timestamp: Date.now(),
    };

    this.circuitBreakerMetrics.push(metric);

    // Keep only last MAX_METRICS
    if (this.circuitBreakerMetrics.length > this.MAX_METRICS) {
      this.circuitBreakerMetrics = this.circuitBreakerMetrics.slice(-this.MAX_METRICS);
    }
  }

  /**
   * Get rate limit metrics summary
   */
  getRateLimitSummary(timeWindowMs: number = 3600000): {
    total: number;
    exceeded: number;
    byEndpoint: Record<string, { total: number; exceeded: number }>;
    bySubscriberType: Record<string, { total: number; exceeded: number }>;
  } {
    const cutoff = Date.now() - timeWindowMs;
    const recent = this.rateLimitMetrics.filter((m) => m.timestamp >= cutoff);

    const byEndpoint: Record<string, { total: number; exceeded: number }> = {};
    const bySubscriberType: Record<string, { total: number; exceeded: number }> = {};

    let exceeded = 0;

    recent.forEach((metric) => {
      // Count by endpoint
      if (!byEndpoint[metric.endpoint]) {
        byEndpoint[metric.endpoint] = { total: 0, exceeded: 0 };
      }
      byEndpoint[metric.endpoint].total += 1;
      if (metric.exceeded) {
        byEndpoint[metric.endpoint].exceeded += 1;
        exceeded += 1;
      }

      // Count by subscriber type
      if (!bySubscriberType[metric.subscriberType]) {
        bySubscriberType[metric.subscriberType] = { total: 0, exceeded: 0 };
      }
      bySubscriberType[metric.subscriberType].total += 1;
      if (metric.exceeded) {
        bySubscriberType[metric.subscriberType].exceeded += 1;
      }
    });

    return {
      total: recent.length,
      exceeded,
      byEndpoint,
      bySubscriberType,
    };
  }

  /**
   * Get circuit breaker metrics summary
   */
  getCircuitBreakerSummary(timeWindowMs: number = 3600000): {
    total: number;
    tripped: number;
    bySubscriberType: Record<string, { total: number; tripped: number }>;
  } {
    const cutoff = Date.now() - timeWindowMs;
    const recent = this.circuitBreakerMetrics.filter((m) => m.timestamp >= cutoff);

    const bySubscriberType: Record<string, { total: number; tripped: number }> = {};

    let tripped = 0;

    recent.forEach((metric) => {
      if (!bySubscriberType[metric.subscriberType]) {
        bySubscriberType[metric.subscriberType] = { total: 0, tripped: 0 };
      }
      bySubscriberType[metric.subscriberType].total += 1;
      if (metric.tripped) {
        bySubscriberType[metric.subscriberType].tripped += 1;
        tripped += 1;
      }
    });

    return {
      total: recent.length,
      tripped,
      bySubscriberType,
    };
  }

  /**
   * Export metrics in Prometheus format (if feature flag enabled)
   * Format: metric_name{label1="value1",label2="value2"} value timestamp
   */
  exportPrometheusFormat(): string {
    if (!this.enabled) {
      return '# Metrics collection disabled\n';
    }

    const rateLimitSummary = this.getRateLimitSummary();
    const breakerSummary = this.getCircuitBreakerSummary();

    let output = '# HELP rate_limit_checks_total Total number of rate limit checks\n';
    output += '# TYPE rate_limit_checks_total counter\n';
    output += `rate_limit_checks_total ${rateLimitSummary.total}\n\n`;

    output += '# HELP rate_limit_exceeded_total Total number of rate limit exceeded events\n';
    output += '# TYPE rate_limit_exceeded_total counter\n';
    output += `rate_limit_exceeded_total ${rateLimitSummary.exceeded}\n\n`;

    // Export by endpoint
    Object.entries(rateLimitSummary.byEndpoint).forEach(([endpoint, stats]) => {
      output += `rate_limit_checks_total{endpoint="${endpoint}"} ${stats.total}\n`;
      output += `rate_limit_exceeded_total{endpoint="${endpoint}"} ${stats.exceeded}\n`;
    });

    output += '\n';

    // Circuit breaker metrics
    output += '# HELP circuit_breaker_events_total Total number of circuit breaker events\n';
    output += '# TYPE circuit_breaker_events_total counter\n';
    output += `circuit_breaker_events_total ${breakerSummary.total}\n\n`;

    output += '# HELP circuit_breaker_tripped_total Total number of circuit breaker trips\n';
    output += '# TYPE circuit_breaker_tripped_total counter\n';
    output += `circuit_breaker_tripped_total ${breakerSummary.tripped}\n\n`;

    // Export by subscriber type
    Object.entries(breakerSummary.bySubscriberType).forEach(([type, stats]) => {
      output += `circuit_breaker_events_total{subscriber_type="${type}"} ${stats.total}\n`;
      output += `circuit_breaker_tripped_total{subscriber_type="${type}"} ${stats.tripped}\n`;
    });

    return output;
  }

  /**
   * Get all metrics as JSON (for API endpoint)
   */
  getMetricsJson(): {
    enabled: boolean;
    rateLimits: ReturnType<typeof this.getRateLimitSummary>;
    circuitBreakers: ReturnType<typeof this.getCircuitBreakerSummary>;
    } {
    return {
      enabled: this.enabled,
      rateLimits: this.getRateLimitSummary(),
      circuitBreakers: this.getCircuitBreakerSummary(),
    };
  }

  /**
   * Clear all metrics (for testing)
   */
  clear(): void {
    this.rateLimitMetrics = [];
    this.circuitBreakerMetrics = [];
  }
}

const metricsService = new MetricsService();

export default metricsService;
