import React, { createContext, useState, useContext, useEffect } from 'react';
import { authService } from '../services';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      authService.setToken(token);
      fetchUser();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchUser = async () => {
    try {
      const userData = await authService.getCurrentUser();
      setUser(userData);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch user', error);
      logout();
    }
  };

  const login = async (email, password) => {
    try {
      const { token: newToken, user: userData } = await authService.login({ email, password });
      authService.setToken(newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Login failed',
      };
    }
  };

  const signup = async (email, password, name) => {
    try {
      const { token: newToken, user: userData } = await authService.signup({ email, password, name });
      authService.setToken(newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Registration failed',
      };
    }
  };

  const loginWithGoogle = async (code) => {
    try {
      const { token: newToken, user: userData } = await authService.loginWithGoogle(code);
      authService.setToken(newToken);
      setToken(newToken);
      setUser(userData);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Google login failed',
      };
    }
  };

  const logout = () => {
    authService.logout();
    setToken(null);
    setUser(null);
  };

  const isPremium = () => {
    return user?.isPremium === true;
  };

  const isEFB = () => {
    return user?.isEFB === true;
  };

  const isAPI = () => {
    return user?.isAPI === true;
  };

  const isFeederProvider = () => {
    return user?.isFeederProvider === true;
  };

  const value = {
    user,
    loading,
    login,
    signup,
    loginWithGoogle,
    logout,
    isPremium,
    isEFB,
    isAPI,
    isFeederProvider,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

