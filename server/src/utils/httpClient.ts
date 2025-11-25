import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import logger from './logger';

declare module 'axios' {
  export interface AxiosRequestConfig {
    retry?: boolean;
    __retryCount?: number;
  }
}

const DEFAULT_TIMEOUT_MS = Math.max(1000, parseInt(process.env.HTTP_CLIENT_TIMEOUT_MS || '10000', 10));
const MAX_RETRIES = Math.max(0, parseInt(process.env.HTTP_CLIENT_MAX_RETRIES || '2', 10));
const BASE_RETRY_DELAY_MS = Math.max(50, parseInt(process.env.HTTP_CLIENT_RETRY_DELAY_MS || '300', 10));

interface RetryConfig extends AxiosRequestConfig {
  __retryCount?: number;
  retry?: boolean; // allow opt-out per request
}

function isTransientError(error: AxiosError): boolean {
  if (!error) {
    return false;
  }

  // Check for network-level transient errors (these have error.code)
  if (error.code) {
    const transientCodes = new Set(['ECONNABORTED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN']);

    if (transientCodes.has(error.code)) {
      return true;
    }
  }

  // Check for HTTP-level transient errors (5xx status codes)
  const status = error.response?.status;
  return status !== undefined && status >= 500;
}

const httpClient: AxiosInstance = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 300,
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = (error.config || {}) as RetryConfig;
    const shouldRetry = config.retry !== false && isTransientError(error);

    if (!shouldRetry) {
      return Promise.reject(error);
    }

    config.__retryCount = (config.__retryCount || 0) + 1;
    if (config.__retryCount > MAX_RETRIES) {
      return Promise.reject(error);
    }

    const delay = BASE_RETRY_DELAY_MS * config.__retryCount;
    logger.warn('Retrying HTTP request after transient error', {
      url: config.url,
      attempt: config.__retryCount,
      delayMs: delay,
      code: error.code,
      status: error.response?.status,
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delay);
    });
    return httpClient(config);
  },
);

export default httpClient;
