import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { useWebSocket } from '../hooks/useWebSocket';

/**
 * WebSocketHandler Component
 * Connects to WebSocket server and handles real-time aircraft updates
 * Only updates when map bounds change significantly
 */
const WebSocketHandler = ({ onAircraftUpdate, onConnectionChange, enabled = true }) => {
  const map = useMap();
  const currentBoundsRef = useRef(null);
  const lastBoundsUpdateRef = useRef(null);

  // Store bounds in state to trigger subscription updates properly
  const [currentBounds, setCurrentBounds] = useState(null);
  
  // Update bounds when map moves
  useEffect(() => {
    const updateBounds = () => {
      const bounds = map.getBounds();
      const newBounds = {
        latmin: bounds.getSouth(),
        lonmin: bounds.getWest(),
        latmax: bounds.getNorth(),
        lonmax: bounds.getEast(),
      };

      // Only update if bounds changed significantly (0.01 degrees ~= 1.1km)
      const boundsChanged = !currentBoundsRef.current ||
        Math.abs(newBounds.latmin - currentBoundsRef.current.latmin) > 0.01 ||
        Math.abs(newBounds.lonmin - currentBoundsRef.current.lonmin) > 0.01 ||
        Math.abs(newBounds.latmax - currentBoundsRef.current.latmax) > 0.01 ||
        Math.abs(newBounds.lonmax - currentBoundsRef.current.lonmax) > 0.01;

      if (boundsChanged) {
        currentBoundsRef.current = newBounds;
        lastBoundsUpdateRef.current = Date.now();
        setCurrentBounds(newBounds);
      }
    };

    // Update bounds immediately
    updateBounds();

    // Update bounds on map move
    map.on('moveend', updateBounds);

    return () => {
      map.off('moveend', updateBounds);
    };
  }, [map]);

  // Use WebSocket hook - maintain single connection, update bounds separately
  const wsHook = useWebSocket({
    bounds: currentBounds, // Pass current bounds (null initially, will update)
    onAircraftUpdate: (update) => {
      if (onAircraftUpdate) {
        onAircraftUpdate(update);
      }
    },
    enabled,
  });

  const { connected, error, socketRef } = wsHook;

  // Update WebSocket subscription when bounds change significantly (without reconnecting)
  useEffect(() => {
    if (currentBounds && socketRef?.current && connected) {
      socketRef.current.emit('subscribe:bounds', currentBounds);
      console.log('Updated WebSocket subscription for new bounds', currentBounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, socketRef, currentBounds?.latmin, currentBounds?.lonmin, currentBounds?.latmax, currentBounds?.lonmax]); // currentBounds object reference changes

  // Expose connection status to parent (via callback)
  useEffect(() => {
    if (onAircraftUpdate && typeof onAircraftUpdate === 'function') {
      // Use a custom event or callback pattern to notify parent of connection status
      // For now, we'll handle it in the update callback
    }
  }, [connected, onAircraftUpdate]);

  // Log connection status and notify parent
  useEffect(() => {
    if (connected) {
      console.log('WebSocket connected - receiving real-time updates');
    } else if (error) {
      console.warn('WebSocket error:', error);
    }
    
    // Notify parent component of connection status change
    if (onConnectionChange) {
      onConnectionChange({ connected, error });
    }
  }, [connected, error, onConnectionChange]);

  return null; // This component doesn't render anything
};

export default WebSocketHandler;

