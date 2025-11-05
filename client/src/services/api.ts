/**
 * Centralized Axios instance configuration
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { API_URL } from '../config';
import type { ApiError } from '../types';

// Create configured Axios instance
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - add auth token if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors globally
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    // Handle 401 unauthorized - clear token and redirect
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      delete api.defaults.headers.common.Authorization;
    }
    return Promise.reject(error);
  }
);

// Helper function to extract error message
export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = error as ApiError;
    return apiError.response?.data?.error || apiError.response?.data?.message || apiError.message || 'An error occurred';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unknown error occurred';
};

export default api;

