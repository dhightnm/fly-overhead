/**
 * Authentication service - handles all auth-related API calls
 */
import api from './api';
import type { User, LoginRequest, SignupRequest, LoginResponse } from '../types';

class AuthService {
  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<User> {
    const response = await api.get<User>('/api/auth/me');
    return response.data;
  }

  /**
   * Login user
   */
  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/login', credentials);
    return response.data;
  }

  /**
   * Register new user
   */
  async signup(userData: SignupRequest): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/register', userData);
    return response.data;
  }

  /**
   * Logout user (client-side only, clears token)
   */
  logout(): void {
    localStorage.removeItem('token');
    delete api.defaults.headers.common.Authorization;
  }

  /**
   * Set authentication token
   */
  setToken(token: string): void {
    localStorage.setItem('token', token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  }

  /**
   * Get authentication token from localStorage
   */
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }
}

export const authService = new AuthService();

