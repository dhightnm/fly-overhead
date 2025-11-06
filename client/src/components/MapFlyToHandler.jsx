import { useMap } from 'react-leaflet';
import { useEffect, useRef } from 'react';

const MapFlyToHandler = ({ searchLatlng, isFullscreen }) => {
  const map = useMap();
  const previousSearchLatlng = useRef(null);

  useEffect(() => {
    // Only fly to if the search location actually changed
    if (searchLatlng && searchLatlng !== previousSearchLatlng.current) {
      console.log('Flying to search location:', searchLatlng);
      
      // Force map to recalculate size first
      map.invalidateSize();
      
      // Wait for size recalculation, then fly smoothly without second jump
      setTimeout(() => {
        if (!isFullscreen) {
          // Calculate a slight offset north to account for UI elements
          const offsetLat = searchLatlng[0] + 0.003; // Small northward shift
          map.flyTo([offsetLat, searchLatlng[1]], 13, {
            duration: 1.0,
            animate: true
          });
        } else {
          // Fullscreen mode - normal centering
          map.flyTo(searchLatlng, 13, {
            duration: 1.0,
            animate: true
          });
        }
      }, 50);
      
      previousSearchLatlng.current = searchLatlng;
    }
  }, [searchLatlng, map, isFullscreen]);

  return null;
};

export default MapFlyToHandler;