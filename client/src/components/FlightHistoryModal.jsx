import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import PremiumModal from './PremiumModal';
import { API_URL } from '../config';
import './FlightHistoryModal.css';

const FlightHistoryModal = ({ icao24, callsign, isOpen, onClose }) => {
  const { isPremium } = useAuth();
  const [history, setHistory] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch both history and route in parallel
      const [historyRes, routeRes] = await Promise.allSettled([
        axios.get(`${API_URL}/api/history/${icao24}`),
        axios.get(`${API_URL}/api/route/${callsign || icao24}`, {
          params: { icao24, callsign },
        }),
      ]);

      if (historyRes.status === 'fulfilled') {
        setHistory(historyRes.value.data);
      } else {
        throw new Error('Failed to fetch history');
      }

      if (routeRes.status === 'fulfilled' && routeRes.value.data) {
        setRoute(routeRes.value.data);
      }
    } catch (err) {
      console.error('Error fetching flight history:', err);
      setError('Failed to load flight history');
    } finally {
      setLoading(false);
    }
  }, [icao24, callsign]);

  useEffect(() => {
    if (isOpen && icao24) {
      fetchHistory();
    }
  }, [isOpen, icao24, fetchHistory]);

  // Calculate current flight duration from route ETE
  const currentFlightDuration = useMemo(() => {
    if (!route) return null;
    
    // Check for actual_ete first (from database)
    if (route.actual_ete) {
      return route.actual_ete;
    }
    
    // Check flightData for ETE
    if (route.flightData?.actualEte) {
      return route.flightData.actualEte;
    }
    
    // Calculate from actual start/end times
    if (route.flightData?.actualDeparture && route.flightData?.actualArrival) {
      const start = route.flightData.actualDeparture * 1000; // Convert to ms if in seconds
      const end = route.flightData.actualArrival * 1000;
      return Math.round((end - start) / 1000); // seconds
    }
    
    // Try actual_flight_start and actual_flight_end from database
    if (route.actual_flight_start && route.actual_flight_end) {
      const start = new Date(route.actual_flight_start);
      const end = new Date(route.actual_flight_end);
      return Math.round((end - start) / 1000); // seconds
    }
    
    return null;
  }, [route]);

  // Filter data based on 24-hour window and premium status
  const { visibleData, lockedCount } = useMemo(() => {
    if (!history?.flightPath) {
      return { visibleData: [], lockedCount: 0 };
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const allData = history.flightPath.map((point) => ({
      ...point,
      timestamp: new Date(point.timestamp),
    }));

    const visible = allData.filter((point) => {
      if (isPremium()) return true; // Premium users see all data
      return point.timestamp >= twentyFourHoursAgo;
    });

    const locked = allData.filter((point) => point.timestamp < twentyFourHoursAgo);

    return {
      visibleData: visible,
      lockedCount: isPremium() ? 0 : locked.length,
    };
  }, [history, isPremium]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatAltitude = (alt) => {
    if (!alt && alt !== 0) return 'N/A';
    return `${Math.round(alt * 3.28084).toLocaleString()} ft`;
  };

  const formatSpeed = (vel) => {
    if (!vel && vel !== 0) return 'N/A';
    return `${Math.round(vel * 1.94384)} kts`;
  };

  const formatHeading = (heading) => {
    if (!heading && heading !== 0) return 'N/A';
    return `${Math.round(heading)}°`;
  };

  const formatVerticalRate = (vr) => {
    if (!vr && vr !== 0) return 'N/A';
    const fpm = Math.round(vr * 196.85); // m/s to ft/min
    return `${fpm > 0 ? '+' : ''}${fpm} fpm`;
  };

  const formatSquawk = (squawk) => {
    if (!squawk) return 'N/A';
    return squawk.toString().padStart(4, '0');
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content flight-history-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>Flight History</h2>
              <div className="header-subtitle">
                {callsign || icao24} • {history?.dataPoints || 0} data points
              </div>
            </div>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>

          <div className="modal-body">
            {loading && (
              <div className="modal-loading">
                <p>Loading flight history...</p>
              </div>
            )}

            {error && (
              <div className="modal-error">
                <p>{error}</p>
              </div>
            )}

            {history && !loading && (
              <>
                {/* Summary Section */}
                <div className="history-summary-table">
                  <table className="summary-table">
                    <tbody>
                      <tr>
                        <td className="summary-label">Aircraft:</td>
                        <td className="summary-value">{callsign || icao24}</td>
                      </tr>
                      <tr>
                        <td className="summary-label">ICAO24:</td>
                        <td className="summary-value">{icao24}</td>
                      </tr>
                      {route && (() => {
                        const hasDeparture = route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name;
                        const hasArrival = route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name;
                        
                        if (hasDeparture || hasArrival) {
                          return (
                            <>
                              <tr>
                                <td className="summary-label">Route:</td>
                                <td className="summary-value route-display">
                                  {route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name || 'N/A'} 
                                  → {route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name || 'N/A'}
                                </td>
                              </tr>
                              <tr>
                                <td className="summary-label">Departure:</td>
                                <td className="summary-value">
                                  {route.departureAirport?.name || route.departureAirport?.icao || route.departureAirport?.iata || 'N/A'}
                                </td>
                              </tr>
                              <tr>
                                <td className="summary-label">Arrival:</td>
                                <td className="summary-value">
                                  {route.arrivalAirport?.name || route.arrivalAirport?.icao || route.arrivalAirport?.iata || 'N/A'}
                                </td>
                              </tr>
                            </>
                          );
                        }
                        return null;
                      })()}
                      <tr>
                        <td className="summary-label">Total Points:</td>
                        <td className="summary-value">{history.dataPoints}</td>
                      </tr>
                      <tr>
                        <td className="summary-label">Flight Duration:</td>
                        <td className="summary-value">
                          {currentFlightDuration ? formatDuration(currentFlightDuration) : 'N/A'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Premium Lock Notice */}
                {lockedCount > 0 && (
                  <div className="premium-lock-notice">
                    <div className="premium-lock-content">
                      <span className="premium-icon">⭐</span>
                      <span className="premium-text">
                        {lockedCount} data point{lockedCount !== 1 ? 's' : ''} older than 24 hours are locked. 
                        <button 
                          className="premium-link" 
                          onClick={() => setShowPremiumModal(true)}
                        >
                          Upgrade to Premium
                        </button>
                        {' '}to view full history.
                      </span>
                    </div>
                  </div>
                )}

                {/* History Table */}
                <div className="history-table-container">
                  <h3>Flight History</h3>
                  {visibleData.length > 0 ? (
                    <div className="table-wrapper">
                      <table className="history-table">
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            <th>Latitude</th>
                            <th>Longitude</th>
                            <th>Baro Altitude</th>
                            <th>Geo Altitude</th>
                            <th>Speed</th>
                            <th>Heading</th>
                            <th>Vertical Rate</th>
                            <th>Squawk</th>
                            <th>On Ground</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleData.map((point, idx) => (
                            <tr key={idx}>
                              <td className="point-time">{formatTimestamp(point.timestamp)}</td>
                              <td className="point-coords">{point.lat?.toFixed(6)}</td>
                              <td className="point-coords">{point.lng?.toFixed(6)}</td>
                              <td>{formatAltitude(point.altitude)}</td>
                              <td>{formatAltitude(point.geoAltitude)}</td>
                              <td>{formatSpeed(point.velocity)}</td>
                              <td>{formatHeading(point.heading)}</td>
                              <td>{formatVerticalRate(point.verticalRate)}</td>
                              <td className="point-squawk">{formatSquawk(point.squawk)}</td>
                              <td className="point-status">{point.onGround ? 'Yes' : 'No'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="no-data">No flight history data available</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <PremiumModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
      />
    </>
  );
};

export default FlightHistoryModal;
