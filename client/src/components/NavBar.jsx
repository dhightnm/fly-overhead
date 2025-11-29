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
  const [showProductsMenu, setShowProductsMenu] = useState(false);
  const { setSearchLatlng } = useContext(PlaneContext);
  const { user, logout, isPremium, isAuthenticated } = useAuth();
  const userMenuRef = useRef(null);
  const productsMenuRef = useRef(null);
  const productsMenuTimeoutRef = useRef(null);
  const history = useHistory();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
      if (productsMenuRef.current && !productsMenuRef.current.contains(event.target)) {
        setShowProductsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (productsMenuTimeoutRef.current) {
        clearTimeout(productsMenuTimeoutRef.current);
      }
    };
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
        <div className="navbar-left-group">
          <a href="/" className="site-title">
            Fly Overhead
          </a>
          <div className="navbar-left" ref={productsMenuRef}>
            <button 
              className="products-menu-button"
              onMouseEnter={() => {
                if (productsMenuTimeoutRef.current) {
                  clearTimeout(productsMenuTimeoutRef.current);
                  productsMenuTimeoutRef.current = null;
                }
                setShowProductsMenu(true);
              }}
              onMouseLeave={() => {
                productsMenuTimeoutRef.current = setTimeout(() => {
                  setShowProductsMenu(false);
                }, 150);
              }}
            >
              Products
              <span className={`products-arrow ${showProductsMenu ? 'open' : ''}`}>▼</span>
            </button>
            {showProductsMenu && (
              <div 
                className="products-dropdown"
                onMouseEnter={() => {
                  if (productsMenuTimeoutRef.current) {
                    clearTimeout(productsMenuTimeoutRef.current);
                    productsMenuTimeoutRef.current = null;
                  }
                  setShowProductsMenu(true);
                }}
                onMouseLeave={() => {
                  productsMenuTimeoutRef.current = setTimeout(() => {
                    setShowProductsMenu(false);
                  }, 150);
                }}
              >
                <div className="products-dropdown-content">
                  <div className="products-dropdown-section">
                    <div 
                      className="product-item"
                      onClick={() => {
                        history.push('/pricing/flight-tracking');
                        setShowProductsMenu(false);
                      }}
                    >
                      <div className="product-item-icon-wrapper">
                        <svg className="product-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
                        </svg>
                      </div>
                      <div className="product-item-content">
                        <div className="product-item-title">Flight Tracking</div>
                        <div className="product-item-description">Real-time aircraft tracking and data</div>
                      </div>
                      <div className="product-item-arrow">→</div>
                    </div>
                    <div 
                      className="product-item"
                      onClick={() => {
                        history.push('/pricing/efb');
                        setShowProductsMenu(false);
                      }}
                    >
                      <div className="product-item-icon-wrapper">
                        <svg className="product-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                          <line x1="12" y1="18" x2="12" y2="18"/>
                        </svg>
                      </div>
                      <div className="product-item-content">
                        <div className="product-item-title">EFB</div>
                        <div className="product-item-description">Electronic Flight Bag with AI assistance</div>
                      </div>
                      <div className="product-item-arrow">→</div>
                    </div>
                    <div 
                      className="product-item"
                      onClick={() => {
                        history.push('/pricing/api');
                        setShowProductsMenu(false);
                      }}
                    >
                      <div className="product-item-icon-wrapper">
                        <svg className="product-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="16 18 22 12 16 6"/>
                          <polyline points="8 6 2 12 8 18"/>
                        </svg>
                      </div>
                      <div className="product-item-content">
                        <div className="product-item-title">API</div>
                        <div className="product-item-description">Developer API for flight data</div>
                      </div>
                      <div className="product-item-arrow">→</div>
                    </div>
                  </div>
                  <div className="products-dropdown-divider"></div>
                  <div className="products-dropdown-section">
                    <div className="product-item coming-soon">
                      <div className="product-item-icon-wrapper">
                        <svg className="product-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                          <circle cx="9" cy="9" r="2"/>
                          <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                        </svg>
                      </div>
                      <div className="product-item-content">
                        <div className="product-item-title">
                          RightSeat AI Copilot
                          <span className="coming-soon-badge">Beta</span>
                        </div>
                        <div className="product-item-description">AI-powered flight assistance in EFB</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        
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
