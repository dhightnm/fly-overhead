import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';
import SatMarker from './SatMarker';
import AirportMarker from './AirportMarker';
import HeatmapLayer from './HeatmapLayer';
import FlightPlanRouteOverlay from './FlightPlanRouteOverlay';
import { PlaneContext } from '../contexts/PlaneContext';
import { useAuth } from '../contexts/AuthContext';
import MapFlyToHandler from './MapFlyToHandler';
import MapResizeHandler from './MapResizeHandler';
import FlightHistoryModal from './FlightHistoryModal';
import WebSocketHandler from './WebSocketHandler';
import PremiumModal from './PremiumModal';
import { API_URL } from '../config';
import './home.css';

const MapEventsHandler = ({ setUserPosition, setPlanes, setStarlink, setAirports, showAirports, websocketConnected, fetchDataRef }) => {
  
  const fetchData = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    
    const bounds = map.getBounds();
    const wrapBounds = map.wrapLatLngBounds(bounds);
    const center = map.getCenter();
    const seaLevel = 0;

    // Fetch starlink data
    try {
      const satRes = await axios.get(
        `${API_URL}/api/starlink/${center.lat}/${center.lng}/${seaLevel}/`
      );
      if (satRes.data && satRes.data.above) {
        setStarlink(satRes.data.above);
      } else {
        console.log('no starlink found');
        setStarlink([]);
      }
    } catch (error) {
      console.error('Error fetching starlink data:', error);
    }

    // Fetch plane data
    try {
      const res = await axios.get(
        `${API_URL}/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`
      );
        if (res.data) {
          // Merge/update planes instead of replacing to preserve state when sidebar covers map
          setPlanes((prevPlanes) => {
            // Create a map of existing planes by icao24 for quick lookup
            const existingPlanesMap = new Map(prevPlanes.map(p => [p.icao24, p]));
            // Merge new data with existing, keeping routes and other metadata
            const mergedPlanes = res.data.map(newPlane => {
              const existing = existingPlanesMap.get(newPlane.icao24);
              return existing ? { ...existing, ...newPlane } : newPlane;
            });
            // Add any existing planes not in the new data (within bounds) to preserve them
            const newPlanesMap = new Map(res.data.map(p => [p.icao24, true]));
            const preservedPlanes = prevPlanes.filter(p => !newPlanesMap.has(p.icao24));
            return [...mergedPlanes, ...preservedPlanes];
          });
      } else {
        console.log('no planes found');
      }
    } catch (error) {
      console.error('Error fetching plane data:', error);
      // Don't clear planes on error - preserve existing state
    }

    // Fetch airports if enabled
    if (showAirports && setAirports) {
      try {
        const airportRes = await axios.get(
          `${API_URL}/api/airports/bounds/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}?limit=150`
        );
        if (airportRes.data && airportRes.data.airports) {
          setAirports(airportRes.data.airports);
        } else {
          setAirports([]);
        }
      } catch (error) {
        console.error('Error fetching airport data:', error);
      }
    } else if (!showAirports) {
      setAirports([]);
    }
  }, [setPlanes, setStarlink, setAirports, showAirports]);

  // Expose fetchData to parent via ref
  React.useEffect(() => {
    if (fetchDataRef) {
      fetchDataRef.current = fetchData;
    }
  }, [fetchData, fetchDataRef]);

  const mapRef = React.useRef(null);
  const hasInitiallyLoaded = React.useRef(false);
  const moveEndTimerRef = React.useRef(null);
  const lastBoundsRef = React.useRef(null);
  
  const map = useMapEvents({
    load: () => {
      map.locate();
    },
    click: () => {},
    locationfound: (location) => {
      setUserPosition(location.latlng);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: () => {
      if (moveEndTimerRef.current) {
        clearTimeout(moveEndTimerRef.current);
      }
      
      const currentBounds = map.getBounds();
      const boundsKey = `${currentBounds.getSouth().toFixed(2)},${currentBounds.getWest().toFixed(2)},${currentBounds.getNorth().toFixed(2)},${currentBounds.getEast().toFixed(2)}`;
      
      if (lastBoundsRef.current === boundsKey) {
        return;
      }
      
      lastBoundsRef.current = boundsKey;
      
      moveEndTimerRef.current = setTimeout(() => {
        fetchData();
      }, 300);
    }
  });

  mapRef.current = map;

  useEffect(() => {
    if (map && !hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      setTimeout(() => {
        fetchData();
        console.log('Initial aircraft data fetch triggered');
      }, 100);
    }
  }, [map, fetchData]);

  useEffect(() => {
    const pollInterval = websocketConnected ? 30 * 1000 : 15 * 1000;
    
    const interval = setInterval(() => {
      if (mapRef.current) {
        fetchData();
        console.log(`Data fetched on interval (${websocketConnected ? 'WebSocket' : 'polling'} mode)`);
      }
    }, pollInterval);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websocketConnected]); // Adjust interval based on WebSocket connection

  return null;
};

const Home = () => {
  const { isPremium } = useAuth();
  const [planes, setPlanes] = useState([]);
  const [routes, setRoutes] = useState({}); // Map of icao24 -> route data
  const [flightPlanRoutes, setFlightPlanRoutes] = useState({}); // Map of icao24 -> flight plan route waypoints
  const [showFlightPlanRoute, setShowFlightPlanRoute] = useState(false); // Toggle for flight plan overlay
  const [routeAvailabilityStatus, setRouteAvailabilityStatus] = useState({}); // Map of icao24 -> { available: boolean, message?: string }
  const [starlink, setStarlink] = useState([]);
  const [airports, setAirports] = useState([]);
  const [userPosition, setUserPosition] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(true); // Default to fullscreen
  const [sidebarOpen, setSidebarOpen] = useState(true); // Sidebar open by default
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [airportSearch, setAirportSearch] = useState('');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [airportSearchResults, setAirportSearchResults] = useState([]);
  const [searchStatus, setSearchStatus] = useState(null);
  const [showAirports, setShowAirports] = useState(true); // Default ON
  const [showClosedAirports, setShowClosedAirports] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [websocketEnabled] = useState(true); // WebSocket enabled by default (reserved for future toggle)
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const fetchDataRef = useRef(null); // Ref to expose fetchData from MapEventsHandler

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;
  const position = searchLatlng || [35.104795500039565, -106.62620902061464];

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    // Force Leaflet map to resize after sidebar animation
    setTimeout(() => {
      // Trigger a resize event which Leaflet listens to
      window.dispatchEvent(new Event('resize'));
      
      // Also directly invalidate any Leaflet map instances
      const mapContainers = document.querySelectorAll('.leaflet-container');
      mapContainers.forEach((container) => {
        // Access the map instance through the container's internal reference
        if (container._leaflet && container._leaflet.map) {
          container._leaflet.map.invalidateSize();
        }
        // Alternative method: trigger resize on the container
        const resizeEvent = new Event('resize');
        container.dispatchEvent(resizeEvent);
      });
    }, 350); // Wait for CSS transition to complete (0.3s + buffer)
  };

  const handleSidebarSearch = async () => {
    if (!sidebarSearch.trim()) {
      setSearchStatus(null);
      return;
    }

    setSearchStatus('searching');
    
    try {
      const res = await axios.get(`${API_URL}/api/planes/${encodeURIComponent(sidebarSearch.trim())}`);
      const planeDetails = res.data;
      
      if (planeDetails && planeDetails.latitude && planeDetails.longitude) {
        contextValue.setSearchLatlng([planeDetails.latitude, planeDetails.longitude]);
        setSearchStatus('found');
        setSidebarSearch('');
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

  const getSearchStatusIcon = () => {
    switch (searchStatus) {
      case 'searching':
        return '🔍';
      case 'found':
        return '✅';
      default:
        return '';
    }
  };

  // Fetch route for a single aircraft (on-demand when user clicks)
  const fetchRouteForAircraft = useCallback(async (plane) => {
    // Skip if we already have the route
    if (routes[plane.icao24]) {
      return routes[plane.icao24];
    }

    console.log(`Fetching route for ${plane.callsign || plane.icao24} (user-initiated)`);

    try {
      const res = await axios.get(`${API_URL}/api/route/${plane.callsign || plane.icao24}`, {
        params: {
          icao24: plane.icao24,
          callsign: plane.callsign,
        },
      });
      
      if (res.data) {
        // Update routes state
        setRoutes((prev) => ({ ...prev, [plane.icao24]: res.data }));
        
        // Update aircraft category in planes state if we got an updated category
        if (res.data.aircraftCategory !== undefined && res.data.aircraftCategory !== null) {
          setPlanes((prevPlanes) => 
            prevPlanes.map((p) => 
              p.icao24 === plane.icao24 
                ? { ...p, category: res.data.aircraftCategory }
                : p
            )
          );
        }
        
        return res.data;
      }
    } catch (error) {
      console.error(`Failed to fetch route for ${plane.callsign || plane.icao24}:`, error);
    }
    return null;
  }, [routes, setPlanes]);

  // Track which routes are currently being fetched to prevent duplicate requests
  const fetchingRoutes = React.useRef(new Set());
  const flightPlanRoutesRef = React.useRef({});
  const routeAvailabilityStatusRef = React.useRef({});

  // Keep refs in sync with state
  useEffect(() => {
    flightPlanRoutesRef.current = flightPlanRoutes;
  }, [flightPlanRoutes]);

  useEffect(() => {
    routeAvailabilityStatusRef.current = routeAvailabilityStatus;
  }, [routeAvailabilityStatus]);

  // Fetch flight plan route for a single aircraft
  const fetchFlightPlanRoute = useCallback(async (plane) => {
    const cacheKey = `${plane.icao24}`;
    
    // Skip if we're already fetching this route
    if (fetchingRoutes.current.has(cacheKey)) {
      return flightPlanRoutesRef.current[plane.icao24] || null;
    }

    // Skip if we already have the flight plan route (and it's available)
    const existingRoute = flightPlanRoutesRef.current[plane.icao24];
    const existingStatus = routeAvailabilityStatusRef.current[plane.icao24];
    if (existingRoute && existingStatus?.available !== false) {
      return existingRoute;
    }

    // Mark as fetching
    fetchingRoutes.current.add(cacheKey);
    console.log(`Fetching flight plan route for ${plane.callsign || plane.icao24}`);

    try {
      const res = await axios.get(`${API_URL}/api/flightplan/${plane.callsign || plane.icao24}`, {
        params: {
          icao24: plane.icao24,
          callsign: plane.callsign,
        },
      });
      
      if (res.data) {
        // Check if route is available
        const isAvailable = res.data.available !== false && res.data.waypoints && res.data.waypoints.length > 0;
        
        // Update availability status
        setRouteAvailabilityStatus((prev) => ({
          ...prev,
          [plane.icao24]: {
            available: isAvailable,
            message: res.data.message || (isAvailable ? null : 'Flight route not available for this flight'),
          },
        }));

        // Store route data (available or not, for UI purposes)
        setFlightPlanRoutes((prev) => ({ ...prev, [plane.icao24]: res.data }));
        
        return res.data;
      }
    } catch (error) {
      // Handle 404 or other errors
      if (error.response?.status === 404 || error.response?.data?.available === false) {
        setRouteAvailabilityStatus((prev) => ({
          ...prev,
          [plane.icao24]: {
            available: false,
            message: error.response?.data?.message || 'Flight route not available for this flight',
          },
        }));
      } else {
        console.error(`Failed to fetch flight plan route for ${plane.callsign || plane.icao24}:`, error);
        setRouteAvailabilityStatus((prev) => ({
          ...prev,
          [plane.icao24]: {
            available: false,
            message: 'Failed to fetch flight route',
          },
        }));
      }
    } finally {
      // Remove from fetching set
      fetchingRoutes.current.delete(cacheKey);
    }
    return null;
  }, []); // Remove dependencies to prevent infinite loops - use refs for caching

  const handleViewHistory = async (plane) => {
    // Fetch route on-demand when user clicks
    await fetchRouteForAircraft(plane);
    
    // Always fetch flight plan route when aircraft is selected
    await fetchFlightPlanRoute(plane);
    
    setSelectedAircraft({
      icao24: plane.icao24,
      callsign: plane.callsign || 'N/A',
    });
    setHistoryModalOpen(true);
  };

  // Fetch flight plan route when toggle is enabled and aircraft is selected
  // Use a ref to track if we've already fetched for this aircraft to prevent re-fetching
  const fetchedRouteForAircraftRef = React.useRef(new Set());
  
  useEffect(() => {
    if (showFlightPlanRoute && selectedAircraft?.icao24) {
      const aircraftKey = selectedAircraft.icao24;
      
      // Skip if we've already fetched for this aircraft in this toggle session
      if (fetchedRouteForAircraftRef.current.has(`${aircraftKey}-${showFlightPlanRoute}`)) {
        return;
      }
      
      // Use setTimeout to avoid running during render
      const timer = setTimeout(() => {
        // Find plane in current planes list
        const plane = planes.find(p => p.icao24 === aircraftKey);
        if (plane) {
          // Only fetch if we don't already have it or if it's not available (to retry)
          const existingRoute = flightPlanRoutesRef.current[plane.icao24];
          const existingStatus = routeAvailabilityStatusRef.current[plane.icao24];
          
          if (!existingRoute || (existingStatus?.available === false)) {
            fetchFlightPlanRoute(plane);
            fetchedRouteForAircraftRef.current.add(`${aircraftKey}-${showFlightPlanRoute}`);
          }
        }
      }, 0);
      
      return () => clearTimeout(timer);
    }
    
    // Reset fetched set when toggle changes
    if (!showFlightPlanRoute) {
      fetchedRouteForAircraftRef.current.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFlightPlanRoute, selectedAircraft?.icao24]); // Only depend on these to prevent infinite loops

  const handleAirportSearch = async () => {
    if (!airportSearch.trim() || airportSearch.trim().length < 2) {
      setAirportSearchResults([]);
      return;
    }

    try {
      const res = await axios.get(`${API_URL}/api/airports/search/${encodeURIComponent(airportSearch.trim())}?limit=10`);
      if (res.data && res.data.airports) {
        setAirportSearchResults(res.data.airports);
      } else {
        setAirportSearchResults([]);
      }
    } catch (err) {
      console.error("Error searching airports:", err);
      setAirportSearchResults([]);
    }
  };

  const handleAirportSelect = (airport) => {
    if (airport && airport.latitude_deg && airport.longitude_deg) {
      contextValue.setSearchLatlng([airport.latitude_deg, airport.longitude_deg]);
      setAirportSearch('');
      setAirportSearchResults([]);
      setSelectedAirport(airport);
      // Enable airports if not already enabled
      if (!showAirports) {
        setShowAirports(true);
      }
    }
  };

  const handleCloseAirportDetail = () => {
    setSelectedAirport(null);
  };

  // Debounced airport search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (airportSearch.trim().length >= 2) {
        handleAirportSearch();
      } else {
        setAirportSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airportSearch]);

  const renderPlanes = () => {
    if (!planes || planes.length === 0) {
      return <p>No planes to display.</p>;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const maxAge = 10 * 60; // 10 minutes in seconds

    return planes.map((plane) => {
      // Filter out stale data (>10 minutes old)
      if (plane.last_contact && (currentTime - plane.last_contact) > maxAge) {
        return null;
      }
      
      // Show only planes that are flying
      if (plane.velocity > 2) {
        return <PlaneMarker 
          key={plane.id} 
          plane={plane} 
          route={routes[plane.icao24]}
          onMarkerClick={async () => {
            await fetchRouteForAircraft(plane);
            await fetchFlightPlanRoute(plane);
            setSelectedAircraft({
              icao24: plane.icao24,
              callsign: plane.callsign || 'N/A',
            });
          }}
        />;
      }
      return null;
    });
  };

  const renderStarlink = () => {
    if (!starlink || starlink.length === 0) {
      return <p>No starlink to display.</p>;
    }

    return starlink.map((sat) => {
      if (sat[6] !== null) {
        return <SatMarker key={sat.satid || sat.id} sat={sat} />;
      }
      return null;
    });
  };

  return (
    <div className={`home-container ${isFullscreen ? 'fullscreen-active' : ''}`}>
      <button className="fullscreen-button" onClick={handleToggleFullscreen}>
        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </button>
      
      <button className="sidebar-toggle" onClick={handleToggleSidebar}>
        {sidebarOpen ? '◄' : '►'}
      </button>

      <div className={`aircraft-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>Aircraft on Screen</h2>
          <p className="aircraft-count">{planes.filter(p => p.velocity > 2).length} active</p>
        </div>
        
        <div className="sidebar-search">
          <div className="search-input-wrapper">
            <input 
              type="text" 
              placeholder="Search ICAO24 or Callsign"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSidebarSearch()}
            />
            <button onClick={handleSidebarSearch} className="search-btn">
              {getSearchStatusIcon()} Search
            </button>
          </div>
          {searchStatus === 'not-found' && (
            <p className="search-error-sidebar">Aircraft not found</p>
          )}
        </div>

        <div className="airport-controls">
          <div className="airport-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showAirports}
                onChange={(e) => setShowAirports(e.target.checked)}
              />
              <span className="toggle-text">Show Airports</span>
            </label>
          </div>
          
          <div className="heatmap-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={(e) => setShowHeatmap(e.target.checked)}
              />
              <span className="toggle-text">Show Traffic Heatmap</span>
            </label>
          </div>
          
          <div className="flightplan-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={showFlightPlanRoute}
                onChange={(e) => {
                  if (!isPremium()) {
                    setShowPremiumModal(true);
                    return;
                  }
                  setShowFlightPlanRoute(e.target.checked);
                }}
                disabled={!selectedAircraft}
              />
              <span className="toggle-text">
                Show Flight Plan Route
                {!isPremium() && <span className="premium-badge-small">⭐ Premium</span>}
                {selectedAircraft && routeAvailabilityStatus[selectedAircraft.icao24]?.available === false && (
                  <span className="route-warning" title={routeAvailabilityStatus[selectedAircraft.icao24]?.message}>
                    ⚠️
                  </span>
                )}
              </span>
            </label>
            {selectedAircraft && routeAvailabilityStatus[selectedAircraft.icao24]?.available === false && (
              <p className="route-unavailable-message">
                {routeAvailabilityStatus[selectedAircraft.icao24]?.message || 'Flight route not available for this flight'}
              </p>
            )}
            {!selectedAircraft && (
              <p className="route-select-hint">Select an aircraft to view flight plan route</p>
            )}
          </div>
          
          {showAirports && (
            <>
              <div className="airport-filter">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={showClosedAirports}
                    onChange={(e) => setShowClosedAirports(e.target.checked)}
                  />
                  <span className="toggle-text">Show Closed Airports</span>
                </label>
              </div>
              
              <div className="airport-search">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    placeholder="Search airports..."
                    value={airportSearch}
                    onChange={(e) => setAirportSearch(e.target.value)}
                  />
                  {airportSearch && (
                    <button 
                      className="clear-btn"
                      onClick={() => {
                        setAirportSearch('');
                        setAirportSearchResults([]);
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {airportSearchResults.length > 0 && (
                  <div className="airport-search-results">
                    {airportSearchResults.map((airport) => (
                      <div
                        key={airport.id}
                        className="airport-result-item"
                        onClick={() => handleAirportSelect(airport)}
                      >
                        <div className="airport-result-header">
                          <span className="airport-result-name">{airport.name}</span>
                          <div className="airport-result-codes">
                            {airport.iata_code && (
                              <span className="airport-result-iata">{airport.iata_code}</span>
                            )}
                            <span className="airport-result-icao">{airport.ident}</span>
                          </div>
                        </div>
                        <div className="airport-result-location">
                          {airport.municipality && `${airport.municipality}, `}
                          {airport.iso_country}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {showAirports && airports.length > 0 && !selectedAirport && (
          <div className="airports-section">
            <div className="section-header">
              <h3>Airports in View</h3>
              <p className="airport-count">
                {airports.filter(a => showClosedAirports || a.type !== 'closed').length} airports
              </p>
            </div>
            <div className="airport-list">
              {airports
                .filter(airport => showClosedAirports || airport.type !== 'closed')
                .slice(0, 10)
                .map((airport) => (
                  <div 
                    key={airport.id} 
                    className="airport-item"
                    onClick={() => handleAirportSelect(airport)}
                  >
                    <div className="airport-item-header">
                      <span className="airport-name">{airport.name}</span>
                      <div className="airport-codes">
                        {airport.iata_code && (
                          <span className="airport-iata">{airport.iata_code}</span>
                        )}
                        <span className="airport-icao">{airport.ident}</span>
                      </div>
                    </div>
                    <div className="airport-item-details">
                      <div className="airport-detail-row">
                        <span className="airport-label">Type:</span>
                        <span className="airport-value">{airport.type?.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="airport-detail-row">
                        <span className="airport-label">Location:</span>
                        <span className="airport-value">
                          {airport.municipality && `${airport.municipality}, `}
                          {airport.iso_country}
                        </span>
                      </div>
                      {airport.runways && airport.runways.length > 0 && (
                        <div className="airport-detail-row">
                          <span className="airport-label">Runways:</span>
                          <span className="airport-value">{airport.runways.length}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              {airports.filter(a => showClosedAirports || a.type !== 'closed').length > 10 && (
                <div className="more-airports">
                  +{airports.filter(a => showClosedAirports || a.type !== 'closed').length - 10} more airports
                </div>
              )}
            </div>
          </div>
        )}

        {selectedAirport && (
          <div className="airports-section airport-detail-view">
            <div className="section-header">
              <h3>Airport Details</h3>
              <button className="close-detail-btn" onClick={handleCloseAirportDetail}>
                ✕
              </button>
            </div>
            <div className="airport-detail-content">
              <div className="airport-detail-main">
                <h4 className="airport-detail-name">{selectedAirport.name}</h4>
                <div className="airport-detail-codes">
                  {selectedAirport.iata_code && (
                    <span className="airport-iata">{selectedAirport.iata_code}</span>
                  )}
                  <span className="airport-icao">{selectedAirport.ident}</span>
                </div>
              </div>

              <div className="airport-detail-info">
                <div className="airport-info-group">
                  <div className="airport-detail-row">
                    <span className="airport-label">Type:</span>
                    <span className="airport-value">{selectedAirport.type?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="airport-detail-row">
                    <span className="airport-label">Location:</span>
                    <span className="airport-value">
                      {selectedAirport.municipality && `${selectedAirport.municipality}, `}
                      {selectedAirport.iso_country}
                    </span>
                  </div>
                  {selectedAirport.elevation_ft && (
                    <div className="airport-detail-row">
                      <span className="airport-label">Elevation:</span>
                      <span className="airport-value">{selectedAirport.elevation_ft.toLocaleString()} ft</span>
                    </div>
                  )}
                  <div className="airport-detail-row">
                    <span className="airport-label">Coordinates:</span>
                    <span className="airport-value">
                      {selectedAirport.latitude_deg.toFixed(4)}, {selectedAirport.longitude_deg.toFixed(4)}
                    </span>
                  </div>
                </div>

                {selectedAirport.runways && selectedAirport.runways.length > 0 && (
                  <div className="airport-info-group">
                    <h5 className="info-group-title">Runways ({selectedAirport.runways.length})</h5>
                    <div className="runways-list">
                      {selectedAirport.runways.map((runway, idx) => (
                        <div key={idx} className="runway-item">
                          <div className="runway-header">
                            <span className="runway-name">
                              {runway.low_end?.ident}/{runway.high_end?.ident}
                            </span>
                            <span className="runway-length">
                              {runway.length_ft ? `${runway.length_ft.toLocaleString()} ft` : 'N/A'}
                            </span>
                          </div>
                          <div className="runway-details">
                            {runway.surface && (
                              <span className="runway-surface">{runway.surface}</span>
                            )}
                            {runway.width_ft && (
                              <span className="runway-width">{runway.width_ft} ft wide</span>
                            )}
                            {runway.lighted && (
                              <span className="runway-lighted">💡 Lighted</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedAirport.frequencies && selectedAirport.frequencies.length > 0 && (
                  <div className="airport-info-group">
                    <h5 className="info-group-title">Frequencies ({selectedAirport.frequencies.length})</h5>
                    <div className="frequencies-list">
                      {selectedAirport.frequencies.map((freq, idx) => (
                        <div key={idx} className="frequency-item">
                          <div className="frequency-type">{freq.type}</div>
                          <div className="frequency-value">{freq.frequency_mhz} MHz</div>
                          {freq.description && (
                            <div className="frequency-desc">{freq.description}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="aircraft-list">
          {planes.filter(p => {
            const currentTime = Math.floor(Date.now() / 1000);
            const maxAge = 10 * 60; // 10 minutes
            const isRecent = !p.last_contact || (currentTime - p.last_contact) <= maxAge;
            return p.velocity > 2 && isRecent;
          }).map((plane) => (
            <div key={plane.id} className="aircraft-item">
              <div className="aircraft-header">
                <span className="aircraft-callsign">{plane.callsign || 'N/A'}</span>
                <span className="aircraft-icao">{plane.icao24}</span>
              </div>
              <div className="aircraft-details">
                {/* Route info removed - only shown when user clicks "View Flight History" */}
                <div className="detail-row">
                  <span className="detail-label">Altitude:</span>
                  <span className="detail-value">{plane.baro_altitude ? `${Math.round(plane.baro_altitude * 3.28084)}ft` : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Speed:</span>
                  <span className="detail-value">{plane.velocity ? `${Math.round(plane.velocity * 1.94384)}kts` : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Heading:</span>
                  <span className="detail-value">{plane.true_track ? `${plane.true_track.toFixed(0)}°` : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Position:</span>
                  <span className="detail-value small">{plane.latitude?.toFixed(4)}, {plane.longitude?.toFixed(4)}</span>
                </div>
                <button 
                  className="view-history-btn"
                  onClick={() => handleViewHistory(plane)}
                >
                  📊 View Flight History
                </button>
              </div>
            </div>
          ))}
          {planes.filter(p => p.velocity > 2).length === 0 && (
            <p className="no-aircraft">No aircraft in view</p>
          )}
        </div>
      </div>

      <div className={isFullscreen ? 'map-fullscreen' : 'map-regular'}>
        <MapContainer
          center={position}
          zoom={12}
          scrollWheelZoom
        >
          
          <MapEventsHandler
            setUserPosition={setUserPosition}
            setPlanes={setPlanes}
            setStarlink={setStarlink}
            setAirports={setAirports}
            showAirports={showAirports}
            websocketConnected={websocketConnected}
            fetchDataRef={fetchDataRef}
          />
          <MapFlyToHandler searchLatlng={searchLatlng} isFullscreen={isFullscreen} />
          <MapResizeHandler sidebarOpen={sidebarOpen} />
          <WebSocketHandler
            enabled={websocketEnabled}
            onConnectionChange={({ connected, error }) => {
              setWebsocketConnected(connected);
              if (error && !connected) {
                console.warn('WebSocket connection failed, falling back to polling');
              }
            }}
            onAircraftUpdate={(update) => {
              // Handle WebSocket updates - trigger immediate refresh on data updates
              if (update.type === 'refresh_required') {
                // Global update signal - immediately fetch fresh data using MapEventsHandler's fetchData
                console.log('WebSocket: Global update signal received, refreshing aircraft positions now');
                
                // Use the fetchData function from MapEventsHandler if available
                if (fetchDataRef.current) {
                  fetchDataRef.current();
                  console.log('WebSocket: Triggered immediate refresh via fetchData');
                } else {
                  // Fallback: fetch directly if ref not available yet
                  const mapElement = document.querySelector('.leaflet-container');
                  if (mapElement && mapElement.__map__) {
                    const map = mapElement.__map__;
                    const bounds = map.getBounds();
                    const wrapBounds = map.wrapLatLngBounds(bounds);
                    
                    axios.get(
                      `${API_URL}/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`
                    ).then((res) => {
                      if (res.data) {
                        // Merge planes instead of replacing to preserve state
                        setPlanes((prevPlanes) => {
                          const existingPlanesMap = new Map(prevPlanes.map(p => [p.icao24, p]));
                          const mergedPlanes = res.data.map(newPlane => {
                            const existing = existingPlanesMap.get(newPlane.icao24);
                            return existing ? { ...existing, ...newPlane } : newPlane;
                          });
                          const newPlanesMap = new Map(res.data.map(p => [p.icao24, true]));
                          const preservedPlanes = prevPlanes.filter(p => !newPlanesMap.has(p.icao24));
                          return [...mergedPlanes, ...preservedPlanes];
                        });
                        console.log(`WebSocket: Refreshed ${res.data.length} aircraft positions (fallback)`);
                      }
                    }).catch((err) => {
                      console.error('Error refreshing aircraft data via WebSocket:', err);
                    });
                  }
                }
              } else if (update.type === 'full' || update.type === 'incremental') {
                // Handle full or incremental updates
                console.log('WebSocket update received:', update.type, 'aircraft count:', Array.isArray(update.data) ? update.data.length : 'N/A');
                
                // If we get a full update with aircraft data, merge it to preserve state
                if (update.type === 'full' && Array.isArray(update.data)) {
                  setPlanes((prevPlanes) => {
                    const existingPlanesMap = new Map(prevPlanes.map(p => [p.icao24, p]));
                    const mergedPlanes = update.data.map(newPlane => {
                      const existing = existingPlanesMap.get(newPlane.icao24);
                      return existing ? { ...existing, ...newPlane } : newPlane;
                    });
                    const newPlanesMap = new Map(update.data.map(p => [p.icao24, true]));
                    const preservedPlanes = prevPlanes.filter(p => !newPlanesMap.has(p.icao24));
                    return [...mergedPlanes, ...preservedPlanes];
                  });
                  console.log('WebSocket: Applied full aircraft update (merged)');
                }
              }
            }}
          />
          <TileLayer
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={position}>
            <Popup>
              A pretty CSS3 popup. <br /> Easily customizable.
            </Popup>
          </Marker>
          {renderStarlink()}
          {renderPlanes()}
          {showAirports && airports
            .filter(airport => showClosedAirports || airport.type !== 'closed')
            .map((airport) => (
              <AirportMarker 
                key={airport.id || airport.ident} 
                airport={airport}
                onAirportClick={handleAirportSelect}
              />
            ))}
        {showHeatmap && planes.length > 0 && (
          <HeatmapLayer
            points={planes.filter(plane => {
              const currentTime = Math.floor(Date.now() / 1000);
              const maxAge = 10 * 60; // 10 minutes
              return plane.velocity > 2 && (!plane.last_contact || (currentTime - plane.last_contact) <= maxAge);
            }).map(plane => ({
              latitude: plane.latitude,
              longitude: plane.longitude,
              intensity: plane.baro_altitude ? Math.max(0.1, 1 - (plane.baro_altitude / 15000)) : 0.5
            }))}
            options={{
                radius: 20,
                blur: 25,
                maxZoom: 15,
                gradient: {
                  0.0: 'rgba(0, 0, 255, 0)',
                  0.2: 'rgba(0, 0, 255, 0.5)',
                  0.4: 'cyan',
                  0.6: 'lime',
                  0.8: 'yellow',
                  1.0: 'red'
                }
              }}
            />
          )}
        {showFlightPlanRoute && selectedAircraft && (() => {
          const flightPlanRoute = flightPlanRoutes[selectedAircraft.icao24];
          // Only show overlay if route is available and has waypoints
          if (flightPlanRoute && flightPlanRoute.available !== false && flightPlanRoute.waypoints && flightPlanRoute.waypoints.length > 0) {
            return (
              <FlightPlanRouteOverlay
                key={flightPlanRoute.icao24 || flightPlanRoute.callsign}
                flightPlanRoute={flightPlanRoute}
                showWaypoints={true}
              />
            );
          }
          return null;
        })()}
        </MapContainer>
      </div>

      {!isFullscreen && (
        <div className="site-info">
          <div className="info-content">
            <h2>Fly Overhead</h2>
            <p>Real-time aircraft tracking powered by OpenSky Network</p>
            <div className="info-grid">
              <div className="info-card">
                <h3>✈️ Live Tracking</h3>
                <p>View aircraft in real-time with position, altitude, speed, and heading data</p>
              </div>
              <div className="info-card">
                <h3>🛰️ Satellite Tracking</h3>
                <p>Monitor Starlink satellites passing overhead your location</p>
              </div>
              <div className="info-card">
                <h3>🔍 Search Aircraft</h3>
                <p>Search by ICAO24 code or flight callsign to track specific aircraft</p>
              </div>
            </div>
            <div className="info-footer">
              <p>Data updates every 15 seconds | Powered by OpenSky Network API</p>
            </div>
          </div>
        </div>
      )}

      <FlightHistoryModal
        icao24={selectedAircraft?.icao24}
        callsign={selectedAircraft?.callsign}
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
      />

      <PremiumModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
      />
    </div>
  );
};

export default Home;
