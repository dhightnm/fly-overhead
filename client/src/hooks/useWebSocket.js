import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../config';

/**
 * Custom hook for WebSocket connection to receive real-time aircraft updates
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.bounds - Bounding box {latmin, lonmin, latmax, lonmax}
 * @param {Function} options.onAircraftUpdate - Callback when aircraft data updates
 * @param {boolean} options.enabled - Whether WebSocket is enabled (default: true)
 * @returns {Object} { connected, error, reconnect }
 */
export function useWebSocket({ bounds, onAircraftUpdate, enabled = true }) {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  useEffect(() => {
    if (!enabled) {
      // Disconnect if WebSocket is disabled
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setConnected(false);
      }
      return;
    }

    // Extract hostname from API_URL for WebSocket connection
    // Socket.IO handles protocol detection automatically
    // If API_URL is http://localhost:3000/api, socketUrl should be http://localhost:3000
    const baseUrl = API_URL.replace('/api', '').replace(/\/$/, ''); // Remove /api and trailing slash
    
    console.log('Connecting to WebSocket at:', baseUrl);

    // Create Socket.IO connection
    const socket = io(baseUrl, {
      transports: ['websocket', 'polling'], // Fallback to polling if WebSocket fails
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('WebSocket connected');
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;

      // Subscribe to bounds when connected
      if (bounds) {
        socket.emit('subscribe:bounds', bounds);
      }
    });

    socket.on('connected', (data) => {
      console.log('WebSocket handshake complete', data);
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      setConnected(false);
      
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, don't reconnect automatically
        setError('Server disconnected');
      }
    });

    socket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err);
      reconnectAttemptsRef.current++;
      
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        setError('Failed to connect to real-time updates. Falling back to polling.');
      } else {
        setError(`Connection error (retrying ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
      }
    });

    // Aircraft update events
    socket.on('aircraft:update', (update) => {
      if (onAircraftUpdate) {
        onAircraftUpdate(update);
      }
    });

    socket.on('aircraft:global_update', (update) => {
      // Global update signal - trigger a refresh of current bounds
      console.log('Global aircraft update received:', update);
      if (onAircraftUpdate) {
        // Signal to fetch new data for current bounds
        onAircraftUpdate({ type: 'refresh_required', ...update });
      }
    });

    // Cleanup on unmount or when enabled changes
    return () => {
      if (socketRef.current && !enabled) {
        console.log('Disconnecting WebSocket');
        if (bounds) {
          socketRef.current.emit('unsubscribe:bounds', bounds);
        }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
    // Only recreate connection when enabled changes, not when bounds change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]); // Only reconnect if enabled flag changes

  // Update subscription when bounds change (without reconnecting)
  useEffect(() => {
    if (socketRef.current && connected && bounds) {
      // Just update subscription, don't disconnect/reconnect
      socketRef.current.emit('subscribe:bounds', bounds);
      console.log('Updated WebSocket bounds subscription', bounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, bounds?.latmin, bounds?.lonmin, bounds?.latmax, bounds?.lonmax]); // bounds object reference changes, so we depend on properties

  const reconnect = () => {
    if (socketRef.current) {
      reconnectAttemptsRef.current = 0;
      socketRef.current.connect();
    }
  };

  // Expose socket ref for manual subscription updates
  return { connected, error, reconnect, socketRef };
}

