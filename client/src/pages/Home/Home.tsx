import React, { useState, useContext, useEffect, useCallback, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import PlaneMarker from '../../components/PlaneMarker';
import SatMarker from '../../components/SatMarker';
import AirportMarker from '../../components/AirportMarker';
import HeatmapLayer from '../../components/HeatmapLayer';
import FlightPlanRouteOverlay from '../../components/FlightPlanRouteOverlay';
import { PlaneContext } from '../../contexts/PlaneContext';
import { useAuth } from '../../contexts/AuthContext';
import MapFlyToHandler from '../../components/MapFlyToHandler';
import MapResizeHandler from '../../components/MapResizeHandler';
import FlightHistoryModal from '../../components/FlightHistoryModal';
import WebSocketHandler from '../../components/WebSocketHandler';
import PremiumModal from '../../components/PremiumModal';
import MapDataFetcher from './MapDataFetcher';
import { useRouteData } from '../../hooks/useRouteData';
import { useAircraftData } from '../../hooks/useAircraftData';
import { aircraftService } from '../../services';
import type { Aircraft, StarlinkSatellite } from '../../types';
import type { AirportSearchResult } from '../../types';
import './Home.css';

const Home: React.FC = () => {
  const { isPremium } = useAuth();
  
  // Use hooks for data management
  const { planes, setPlanes, searchAircraft: searchAircraftInHook, updateAircraftCategory } = useAircraftData();
  const { routes, flightPlanRoutes, routeAvailabilityStatus, fetchRouteForAircraft, fetchFlightPlanRoute } = useRouteData();
  
  const [showFlightPlanRoute, setShowFlightPlanRoute] = useState(false);
  const [starlink, setStarlink] = useState<StarlinkSatellite[]>([]);
  const [airports, setAirports] = useState<AirportSearchResult[]>([]);
  const [userPosition, setUserPosition] = useState<[number, number] | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [airportSearch, setAirportSearch] = useState('');
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [airportSearchResults, setAirportSearchResults] = useState<AirportSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<'searching' | 'found' | 'not-found' | null>(null);
  const [showAirports, setShowAirports] = useState(true);
  const [showClosedAirports, setShowClosedAirports] = useState(false);
  const [selectedAirport, setSelectedAirport] = useState<AirportSearchResult | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState<{ icao24: string; callsign: string } | null>(null);
  const [websocketEnabled] = useState(true);
  const [websocketConnected, setWebsocketConnected] = useState(false);
  const fetchDataRef = useRef<(() => Promise<void>) | null>(null);

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;
  const position = searchLatlng || [35.104795500039565, -106.62620902061464];

  // Keep refs in sync with state for flight plan routes
  const flightPlanRoutesRef = useRef<Record<string, any>>({});
  const routeAvailabilityStatusRef = useRef<Record<string, any>>({});

  useEffect(() => {
    flightPlanRoutesRef.current = flightPlanRoutes;
  }, [flightPlanRoutes]);

  useEffect(() => {
    routeAvailabilityStatusRef.current = routeAvailabilityStatus;
  }, [routeAvailabilityStatus]);

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      const mapContainers = document.querySelectorAll('.leaflet-container');
      mapContainers.forEach((container) => {
        if ((container as any)._leaflet && (container as any)._leaflet.map) {
          (container as any)._leaflet.map.invalidateSize();
        }
        const resizeEvent = new Event('resize');
        container.dispatchEvent(resizeEvent);
      });
    }, 350);
  };

  const handleSidebarSearch = async () => {
    if (!sidebarSearch.trim()) {
      setSearchStatus(null);
      return;
    }

    setSearchStatus('searching');
    
    try {
      const aircraft = await searchAircraftInHook(sidebarSearch.trim());
      
      if (aircraft && aircraft.latitude && aircraft.longitude) {
        contextValue.setSearchLatlng([aircraft.latitude, aircraft.longitude]);
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

  // Fetch route wrapper to update aircraft category when route is fetched
  const fetchRouteForAircraftWithCategoryUpdate = useCallback(async (plane: Aircraft, isPrefetch = false) => {
    const route = await fetchRouteForAircraft(plane, isPrefetch);
    
    if (route?.aircraftCategory !== undefined && route.aircraftCategory !== null) {
      updateAircraftCategory(plane.icao24, route.aircraftCategory);
    }
    
    return route;
  }, [fetchRouteForAircraft, updateAircraftCategory]);

  const handleViewHistory = async (plane: Aircraft) => {
    await fetchRouteForAircraftWithCategoryUpdate(plane);
    await fetchFlightPlanRoute(plane);
    
    setSelectedAircraft({
      icao24: plane.icao24,
      callsign: plane.callsign || 'N/A',
    });
    setHistoryModalOpen(true);
  };

  // Fetch flight plan route when toggle is enabled and aircraft is selected
  const fetchedRouteForAircraftRef = useRef(new Set<string>());
  
  useEffect(() => {
    if (showFlightPlanRoute && selectedAircraft?.icao24) {
      const aircraftKey = selectedAircraft.icao24;
      
      if (fetchedRouteForAircraftRef.current.has(`${aircraftKey}-${showFlightPlanRoute}`)) {
        return;
      }
      
      const timer = setTimeout(() => {
        const plane = planes.find(p => p.icao24 === aircraftKey);
        if (plane) {
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
    
    if (!showFlightPlanRoute) {
      fetchedRouteForAircraftRef.current.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFlightPlanRoute, selectedAircraft?.icao24, planes, fetchFlightPlanRoute]);

  const handleAirportSearch = async () => {
    if (!airportSearch.trim() || airportSearch.trim().length < 2) {
      setAirportSearchResults([]);
      return;
    }

    try {
      const results = await aircraftService.searchAirports(airportSearch.trim(), 10);
      setAirportSearchResults(results);
    } catch (err) {
      console.error("Error searching airports:", err);
      setAirportSearchResults([]);
    }
  };

  const handleAirportSelect = (airport: AirportSearchResult) => {
    if (airport && airport.latitude_deg && airport.longitude_deg) {
      contextValue.setSearchLatlng([airport.latitude_deg, airport.longitude_deg]);
      setAirportSearch('');
      setAirportSearchResults([]);
      setSelectedAirport(airport);
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
    const maxAge = 10 * 60;

    return planes.map((plane: Aircraft) => {
      if (plane.last_contact && (currentTime - plane.last_contact) > maxAge) {
        return null;
      }
      
      if (plane.velocity > 2) {
        return <PlaneMarker 
          key={plane.id || plane.icao24} 
          plane={plane} 
          route={routes[plane.icao24]}
          onMarkerClick={async (isPrefetch = false) => {
            if (!isPrefetch) {
              setSelectedAircraft({
                icao24: plane.icao24,
                callsign: plane.callsign || 'N/A',
              });
            }
            
            await Promise.all([
              fetchRouteForAircraftWithCategoryUpdate(plane, isPrefetch),
              fetchFlightPlanRoute(plane)
            ]);
          }}
        />;
      }
      return null;
    });
  };

  const renderStarlink = () => {
    if (!starlink || starlink.length === 0) {
      return null;
    }

    return starlink.map((sat: StarlinkSatellite) => {
      if (sat.visibility !== null && sat.visibility !== undefined) {
        return <SatMarker key={sat.satid || sat.satname} sat={sat} />;
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
                            {airport.iata && (
                              <span className="airport-result-iata">{airport.iata}</span>
                            )}
                            <span className="airport-result-icao">{airport.icao || airport.id?.toString()}</span>
                          </div>
                        </div>
                        <div className="airport-result-location">
                          {airport.municipality && `${airport.municipality}, `}
                          {airport.country}
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
                        {airport.iata && (
                          <span className="airport-iata">{airport.iata}</span>
                        )}
                        <span className="airport-icao">{airport.icao || airport.id}</span>
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
                          {airport.country}
                        </span>
                      </div>
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
                  {selectedAirport.iata && (
                    <span className="airport-iata">{selectedAirport.iata}</span>
                  )}
                  <span className="airport-icao">{selectedAirport.icao || selectedAirport.id}</span>
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
                      {selectedAirport.country}
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
                      {selectedAirport.latitude_deg?.toFixed(4)}, {selectedAirport.longitude_deg?.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="aircraft-list">
          {planes.filter(p => {
            const currentTime = Math.floor(Date.now() / 1000);
            const maxAge = 10 * 60;
            const isRecent = !p.last_contact || (currentTime - p.last_contact) <= maxAge;
            return p.velocity > 2 && isRecent;
          }).map((plane: Aircraft) => (
            <div key={plane.id || plane.icao24} className="aircraft-item">
              <div className="aircraft-header">
                <span className="aircraft-callsign">{plane.callsign || 'N/A'}</span>
                <span className="aircraft-icao">{plane.icao24}</span>
              </div>
              <div className="aircraft-details">
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
          <MapDataFetcher
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
              if (update.type === 'refresh_required') {
                console.log('WebSocket: Global update signal received, refreshing aircraft positions now');
                
                if (fetchDataRef.current) {
                  fetchDataRef.current();
                  console.log('WebSocket: Triggered immediate refresh via fetchData');
                } else {
                  // Fallback: use aircraftService if ref not available
                  const mapElement = document.querySelector('.leaflet-container');
                  if (mapElement && (mapElement as any).__map__) {
                    const map = (mapElement as any).__map__;
                    const bounds = map.getBounds();
                    const wrapBounds = map.wrapLatLngBounds(bounds);
                    
                    aircraftService.getAircraftInBounds({
                      southWest: wrapBounds.getSouthWest(),
                      northEast: wrapBounds.getNorthEast(),
                    }).then((aircraft) => {
                      if (aircraft) {
                        setPlanes((prevPlanes) => {
                          const existingPlanesMap = new Map(prevPlanes.map(p => [p.icao24, p]));
                          const mergedPlanes = aircraft.map(newPlane => {
                            const existing = existingPlanesMap.get(newPlane.icao24);
                            return existing ? { ...existing, ...newPlane } : newPlane;
                          });
                          const newPlanesMap = new Map(aircraft.map(p => [p.icao24, true]));
                          const preservedPlanes = prevPlanes.filter(p => !newPlanesMap.has(p.icao24));
                          return [...mergedPlanes, ...preservedPlanes];
                        });
                        console.log(`WebSocket: Refreshed ${aircraft.length} aircraft positions (fallback)`);
                      }
                    }).catch((err) => {
                      console.error('Error refreshing aircraft data via WebSocket:', err);
                    });
                  }
                }
              } else if (update.type === 'full' || update.type === 'incremental') {
                console.log('WebSocket update received:', update.type, 'aircraft count:', Array.isArray(update.data) ? update.data.length : 'N/A');
                
                if (update.type === 'full' && Array.isArray(update.data)) {
                  setPlanes((prevPlanes) => {
                    const existingPlanesMap = new Map(prevPlanes.map(p => [p.icao24, p]));
                    const mergedPlanes = update.data.map((newPlane: Aircraft) => {
                      const existing = existingPlanesMap.get(newPlane.icao24);
                      return existing ? { ...existing, ...newPlane } : newPlane;
                    });
                    const newPlanesMap = new Map(update.data.map((p: Aircraft) => [p.icao24, true]));
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
                key={airport.id || airport.icao} 
                airport={airport}
                onAirportClick={handleAirportSelect}
              />
            ))}
        {showHeatmap && planes.length > 0 && (
          <HeatmapLayer
            points={planes.filter(plane => {
              const currentTime = Math.floor(Date.now() / 1000);
              const maxAge = 10 * 60;
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
        onSignup={() => setShowPremiumModal(false)}
      />
    </div>
  );
};

export default Home;

