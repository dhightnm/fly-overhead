/**
 * Authentication and user type definitions
 */

export interface User {
  id: number;
  email: string;
  name?: string;
  isPremium: boolean;
  premiumExpiresAt?: string | null;
  isEFB?: boolean;
  isAPI?: boolean;
  isFeederProvider?: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  success: boolean;
  error?: string;
  token?: string;
  user?: User;
}

