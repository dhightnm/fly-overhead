import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import './LoginModal.css';

const LoginModal = ({ isOpen, onClose, onSwitchToSignup }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(email, password);
    
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    
    setLoading(false);
  };

  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';
  const hasGoogleAuth = !!googleClientId && googleClientId !== 'dummy-client-id';
  
  // Always call the hook (React rules), but only use it if Google auth is enabled
  const handleGoogleLoginHook = useGoogleLogin({
    flow: 'auth-code',
    onSuccess: async (codeResponse) => {
      if (!hasGoogleAuth) return;
      
      setError('');
      setLoading(true);
      
      try {
        // Exchange authorization code for ID token via backend
        const result = await loginWithGoogle(codeResponse.code);
        
        if (result.success) {
          onClose();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError('Google sign-in failed. Please try again.');
        console.error('Google login error:', err);
      }
      
      setLoading(false);
    },
    onError: () => {
      if (!hasGoogleAuth) return;
      setError('Google sign-in failed. Please try again.');
      setLoading(false);
    },
  });
  
  const handleGoogleLogin = hasGoogleAuth ? handleGoogleLoginHook : () => {
    setError('Google sign-in is not configured');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Sign In</h2>
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}
          
          {googleClientId && googleClientId !== 'dummy-client-id' && (
            <>
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="btn-google"
                disabled={loading}
              >
                <svg className="google-icon" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading ? 'Signing in...' : 'Continue with Google'}
              </button>
              
              <div className="divider">
                <span>or</span>
              </div>
            </>
          )}
          
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div className="modal-footer">
          <p>
            Don't have an account?{' '}
            <button type="button" className="link-button" onClick={onSwitchToSignup}>
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginModal;

