import React, { useState, useContext, useRef, useEffect } from 'react';
import { PlaneContext } from '../contexts/PlaneContext';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';
import LoginModal from './LoginModal';
import SignupModal from './SignupModal';
import PremiumModal from './PremiumModal';
import './navbar.css';

const NavBar = () => {
  const [search, setSearch] = useState('');
  const [searchStatus, setSearchStatus] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showSignupModal, setShowSignupModal] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { setSearchLatlng } = useContext(PlaneContext);
  const { user, logout, isPremium, isAuthenticated } = useAuth();
  const userMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = async () => {
    if (!search.trim()) {
      setSearchStatus(null);
      return;
    }

    setSearchStatus('searching');
    
    try {
      const res = await axios.get(`${API_URL}/api/planes/${encodeURIComponent(search.trim())}`);
      const planeDetails = res.data;
      
      if (planeDetails && planeDetails.latitude && planeDetails.longitude) {
        setSearchLatlng([planeDetails.latitude, planeDetails.longitude]);
        setSearchStatus('found');
        setTimeout(() => setSearchStatus(null), 3000);
      } else {
        setSearchStatus('not-found');
        setTimeout(() => setSearchStatus(null), 3000);
      }
    } catch (err) {
      console.error("Error searching for aircraft:", err);
      setSearchStatus('not-found');
      setTimeout(() => setSearchStatus(null), 3000);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const getStatusIcon = () => {
    switch (searchStatus) {
      case 'searching':
        return '🔍';
      case 'found':
        return '✅';
      case 'not-found':
        return '❌';
      default:
        return '';
    }
  };

  const getUserInitials = () => {
    if (!user?.name) return 'U';
    return user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <>
      <nav className="navbar">
        <a href="/" className="site-title">
          ✈️ Fly Overhead
        </a>
        
        <div className="navbar-center">
          <div className="search-container">
            <input 
              type="text" 
              placeholder="Search by ICAO24 or Callsign" 
              value={search} 
              onChange={(e) => setSearch(e.target.value)}
              onKeyPress={handleKeyPress}
            />
            <button onClick={handleSearch}>
              {getStatusIcon()} Search
            </button>
            {searchStatus === 'not-found' && (
              <span className="search-error">Aircraft not found</span>
            )}
          </div>
        </div>

        <div className="navbar-right">
          {!isAuthenticated ? (
            <>
              <button 
                className="nav-button"
                onClick={() => setShowLoginModal(true)}
              >
                Sign In
              </button>
              <button 
                className="nav-button nav-button-primary"
                onClick={() => setShowSignupModal(true)}
              >
                Sign Up
              </button>
            </>
          ) : (
            <>
              {!isPremium() && (
                <button 
                  className="nav-button nav-button-premium"
                  onClick={() => setShowPremiumModal(true)}
                >
                  ⭐ Premium
                </button>
              )}
              <div className="user-menu" ref={userMenuRef}>
                <div 
                  className="user-avatar"
                  onClick={() => setShowUserMenu(!showUserMenu)}
                >
                  {getUserInitials()}
                </div>
                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="user-dropdown-item">
                      {user.name}
                      {isPremium() && <span className="premium-indicator">PREMIUM</span>}
                    </div>
                    <div className="user-dropdown-item">{user.email}</div>
                    {!isPremium() && (
                      <button 
                        className="user-dropdown-item premium-badge"
                        onClick={() => {
                          setShowPremiumModal(true);
                          setShowUserMenu(false);
                        }}
                      >
                        ⭐ Upgrade to Premium
                      </button>
                    )}
                    <button 
                      className="user-dropdown-item"
                      onClick={() => {
                        logout();
                        setShowUserMenu(false);
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </nav>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSwitchToSignup={() => {
          setShowLoginModal(false);
          setShowSignupModal(true);
        }}
      />

      <SignupModal
        isOpen={showSignupModal}
        onClose={() => setShowSignupModal(false)}
        onSwitchToLogin={() => {
          setShowSignupModal(false);
          setShowLoginModal(true);
        }}
      />

      <PremiumModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        onSignup={() => setShowSignupModal(true)}
      />
    </>
  );
};

export default NavBar;
