import React, { useState, useContext, useRef, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { PlaneContext } from '../contexts/PlaneContext';
import { useAuth } from '../contexts/AuthContext';
import { aircraftService } from '../services';
import LoginModal from './LoginModal';
import SignupModal from './SignupModal';
import PremiumModal from './PremiumModal';
import './navbar.css';

const STALE_SEARCH_THRESHOLD_SECONDS = 6 * 60 * 60; // 6 hours

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
  const history = useHistory();

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
      const aircraft = await aircraftService.searchAircraft(search.trim());
      
      if (aircraft) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const dataAgeSeconds = typeof aircraft.data_age_seconds === 'number'
          ? aircraft.data_age_seconds
          : typeof aircraft.last_contact === 'number'
            ? Math.max(0, nowSeconds - aircraft.last_contact)
            : null;

        if (dataAgeSeconds !== null && dataAgeSeconds > STALE_SEARCH_THRESHOLD_SECONDS) {
          console.info('Search result is stale, skipping display', {
            identifier: search.trim(),
            icao24: aircraft.icao24,
            dataAgeSeconds,
          });
          setSearchStatus('stale');
          setTimeout(() => setSearchStatus(null), 4000);
          return;
        }

        let targetLat = aircraft.latitude;
        let targetLng = aircraft.longitude;
        
        // Helper function to calculate distance between two points in km
        const calculateDistance = (lat1, lng1, lat2, lng2) => {
          const R = 6371; // Earth's radius in km
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLng = (lng2 - lng1) * Math.PI / 180;
          const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };
        
        // Only use arrival airport location if:
        // 1. Plane is on ground, OR
        // 2. Plane is within 5km of arrival airport AND has arrival airport AND velocity < 50
        if (aircraft.route?.arrivalAirport?.location) {
          const distanceToArrival = calculateDistance(
            aircraft.latitude,
            aircraft.longitude,
            aircraft.route.arrivalAirport.location.lat,
            aircraft.route.arrivalAirport.location.lng
          );
          
          const hasLanded = aircraft.on_ground === true || 
            (distanceToArrival <= 5 && aircraft.velocity !== undefined && aircraft.velocity < 50);
          
          if (hasLanded) {
            targetLat = aircraft.route.arrivalAirport.location.lat;
            targetLng = aircraft.route.arrivalAirport.location.lng;
          }
        }
        
        if (targetLat && targetLng) {
          setSearchLatlng([targetLat, targetLng]);
          setSearchStatus('found');
          setTimeout(() => setSearchStatus(null), 3000);
        } else {
          setSearchStatus('not-found');
          setTimeout(() => setSearchStatus(null), 3000);
        }
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
      case 'stale':
        return '🕑';
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
          Fly Overhead
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
            {searchStatus === 'stale' && (
              <span className="search-error">Aircraft is no longer active</span>
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
              <button 
                className="nav-button nav-button-portal"
                onClick={() => history.push('/portal')}
              >
                Portal
              </button>
              {!isPremium() && (
                <button 
                  className="nav-button nav-button-premium"
                  onClick={() => history.push('/tiers')}
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
                    <button 
                      className="user-dropdown-item"
                      onClick={() => {
                        history.push('/portal');
                        setShowUserMenu(false);
                      }}
                    >
                      🎛️ Portal
                    </button>
                    {!isPremium() && (
                      <button 
                        className="user-dropdown-item premium-badge"
                        onClick={() => {
                          history.push('/tiers');
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
