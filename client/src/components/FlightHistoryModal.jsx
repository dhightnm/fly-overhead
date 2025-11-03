import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import './FlightHistoryModal.css';

const FlightHistoryModal = ({ icao24, callsign, isOpen, onClose }) => {
  const [history, setHistory] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatAltitude = (alt) => {
    if (!alt) return 'N/A';
    return `${(alt * 0.3048 / 100).toFixed(2)} km`;
  };

  const formatSpeed = (vel) => {
    if (!vel) return 'N/A';
    return `${(vel * 0.514).toFixed(0)} mph`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Flight History</h2>
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
              <div className="history-summary">
                <div className="summary-item">
                  <span className="summary-label">Aircraft:</span>
                  <span className="summary-value">{callsign || icao24}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">ICAO24:</span>
                  <span className="summary-value">{icao24}</span>
                </div>
                {route && (() => {
                  const hasDeparture = route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name;
                  const hasArrival = route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name;
                  
                  // Only show route if we have actual airport codes/names
                  if (hasDeparture || hasArrival) {
                    return (
                      <>
                        <div className="summary-item full-width">
                          <span className="summary-label">Route:</span>
                          <span className="summary-value route-display">
                            {route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name || 'N/A'} 
                            → {route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name || 'N/A'}
                          </span>
                        </div>
                        <div className="summary-item">
                          <span className="summary-label">Departure:</span>
                          <span className="summary-value">
                            {route.departureAirport?.name || route.departureAirport?.icao || route.departureAirport?.iata || 'N/A'}
                          </span>
                        </div>
                        <div className="summary-item">
                          <span className="summary-label">Arrival:</span>
                          <span className="summary-value">
                            {route.arrivalAirport?.name || route.arrivalAirport?.icao || route.arrivalAirport?.iata || 'N/A'}
                          </span>
                        </div>
                      </>
                    );
                  }
                  return null;
                })()}
                <div className="summary-item">
                  <span className="summary-label">Data Points:</span>
                  <span className="summary-value">{history.dataPoints}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Duration:</span>
                  <span className="summary-value">
                    {history.startTime && history.endTime
                      ? `${Math.round((new Date(history.endTime) - new Date(history.startTime)) / 1000 / 60)} minutes`
                      : 'N/A'}
                  </span>
                </div>
              </div>

              <div className="history-list-container">
                <h3>Flight Path Data ({history.flightPath?.length || 0} points)</h3>
                <div className="history-list">
                  {history.flightPath && history.flightPath.length > 0 ? (
                    history.flightPath.map((point, index) => (
                      <div key={index} className="history-point">
                        <div className="point-header">
                          <span className="point-number">#{index + 1}</span>
                          <span className="point-time">{formatTimestamp(point.timestamp)}</span>
                        </div>
                        <div className="point-details">
                          <div className="point-row">
                            <span className="point-label">Position:</span>
                            <span className="point-value">
                              {point.lat?.toFixed(4)}, {point.lng?.toFixed(4)}
                            </span>
                          </div>
                          <div className="point-row">
                            <span className="point-label">Altitude:</span>
                            <span className="point-value">{formatAltitude(point.altitude)}</span>
                          </div>
                          <div className="point-row">
                            <span className="point-label">Speed:</span>
                            <span className="point-value">{formatSpeed(point.velocity)}</span>
                          </div>
                          <div className="point-row">
                            <span className="point-label">Heading:</span>
                            <span className="point-value">
                              {point.heading ? `${point.heading.toFixed(0)}°` : 'N/A'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="no-data">No flight path data available</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FlightHistoryModal;

