import React, { useState, useContext, useEffect, useCallback } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';
import SatMarker from './SatMarker';
import { PlaneContext } from '../contexts/PlaneContext';
import MapFlyToHandler from './MapFlyToHandler';
import FlightHistoryModal from './FlightHistoryModal';
// Import your CSS
import './home.css';

const MapEventsHandler = ({ setUserPosition, setPlanes, setStarlink, fetchRoutesCallback }) => {
  const API_URL = "http://localhost:3005";
  
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
          setPlanes(res.data);
          // Trigger route fetching
          if (fetchRoutesCallback) {
            fetchRoutesCallback(res.data);
          }
      } else {
        console.log('no planes found');
      }
    } catch (error) {
      console.error('Error fetching plane data:', error);
    }
  }, [API_URL, setPlanes, setStarlink, fetchRoutesCallback]);

  const mapRef = React.useRef(null);
  const map = useMapEvents({
    load: async () => {
      const loadCenter = map.locate().getCenter();
      loadCenter();
      try {
        const res = await axios.get(`${API_URL}/api/area/all`);
        if (res.data) {
          setPlanes(res.data);
          // Trigger route fetching for initial load
          if (fetchRoutesCallback) {
            fetchRoutesCallback(res.data);
          }
        } else { 
          console.log('no planes found');
        }
      } catch (error) {
        console.error('Error fetching initial plane data:', error);
      }
    },
    click: () => {},
    locationfound: (location) => {
      setUserPosition(location.latlng);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: async () => {
      // fetch data whenever the map finishes moving
      await fetchData();
    }
  });

  mapRef.current = map;

  useEffect(() => {
    // Fire the fetchData on an interval to keep the data fresh
    const interval = setInterval(() => {
      fetchData();
      console.log("Data fetched on interval");
    }, 15 * 1000);

    return () => clearInterval(interval);
  }, [fetchData]);

  return null;
};

const Home = () => {
  const API_URL = "http://localhost:3005";
  const [planes, setPlanes] = useState([]);
  const [routes, setRoutes] = useState({}); // Map of icao24 -> route data
  const [starlink, setStarlink] = useState([]);
  const [userPosition, setUserPosition] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(true); // Default to fullscreen
  const [sidebarOpen, setSidebarOpen] = useState(true); // Sidebar open by default
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [searchStatus, setSearchStatus] = useState(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState(null);

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;
  const position = searchLatlng || [35.104795500039565, -106.62620902061464];

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSidebarSearch = async () => {
    if (!sidebarSearch.trim()) {
      setSearchStatus(null);
      return;
    }

    setSearchStatus('searching');
    
    try {
      const res = await axios.get(`http://localhost:3005/api/planes/${encodeURIComponent(sidebarSearch.trim())}`);
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

  const fetchRoutesForAircraft = async (aircraftList) => {
    // Filter to only new aircraft we haven't fetched routes for
    const aircraftNeedingRoutes = aircraftList.filter(
      (plane) => plane.icao24 && !routes[plane.icao24] && plane.callsign && plane.velocity > 2
    );

    if (aircraftNeedingRoutes.length === 0) return;

    // Fetch routes in parallel (with limit to avoid overwhelming API)
    const routePromises = aircraftNeedingRoutes.slice(0, 10).map(async (plane) => {
      try {
        const res = await axios.get(`${API_URL}/api/route/${plane.callsign || plane.icao24}`, {
          params: {
            icao24: plane.icao24,
            callsign: plane.callsign,
          },
        });
        
        if (res.data) {
          return { icao24: plane.icao24, route: res.data };
        }
      } catch (error) {
        // Route not found is OK, just skip
      }
      return null;
    });

    const routeResults = await Promise.allSettled(routePromises);
    
    const newRoutes = {};
    routeResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        newRoutes[result.value.icao24] = result.value.route;
      }
    });

    if (Object.keys(newRoutes).length > 0) {
      setRoutes((prev) => ({ ...prev, ...newRoutes }));
    }
  };

  const handleViewHistory = (plane) => {
    setSelectedAircraft({
      icao24: plane.icao24,
      callsign: plane.callsign || 'N/A',
    });
    setHistoryModalOpen(true);
  };

  const renderPlanes = () => {
    if (!planes || planes.length === 0) {
      return <p>No planes to display.</p>;
    }

    return planes.map((plane) => {
      // Show only planes that are flying
      if (plane.velocity > 2) {
        return <PlaneMarker key={plane.id} plane={plane} route={routes[plane.icao24]} />;
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

        <div className="aircraft-list">
          {planes.filter(p => p.velocity > 2).map((plane) => (
            <div key={plane.id} className="aircraft-item">
              <div className="aircraft-header">
                <span className="aircraft-callsign">{plane.callsign || 'N/A'}</span>
                <span className="aircraft-icao">{plane.icao24}</span>
              </div>
              <div className="aircraft-details">
                {routes[plane.icao24] && (() => {
                  const route = routes[plane.icao24];
                  const departureCode = route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name;
                  const arrivalCode = route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name;
                  
                  // Show route if we have any airport codes OR if both locations exist (inferred route)
                  if (departureCode || arrivalCode || (route.departureAirport?.location && route.arrivalAirport?.location)) {
                    return (
                      <div className="route-info">
                        <div className="route-row">
                          <span className="route-label">From:</span>
                          <span className="route-value">
                            {departureCode || (route.departureAirport?.inferred ? 'Unknown' : 'N/A')}
                          </span>
                        </div>
                        <div className="route-row">
                          <span className="route-label">To:</span>
                          <span className="route-value">
                            {arrivalCode || (route.arrivalAirport?.inferred ? 'Unknown' : 'N/A')}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="detail-row">
                  <span className="detail-label">Altitude:</span>
                  <span className="detail-value">{plane.baro_altitude ? `${(plane.baro_altitude * 0.3048 / 100).toFixed(0)} km` : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Speed:</span>
                  <span className="detail-value">{plane.velocity ? `${(plane.velocity * 0.514).toFixed(0)} mph` : 'N/A'}</span>
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
            fetchRoutesCallback={fetchRoutesForAircraft}
          />
          <MapFlyToHandler searchLatlng={searchLatlng} isFullscreen={isFullscreen} />
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
    </div>
  );
};

export default Home;
