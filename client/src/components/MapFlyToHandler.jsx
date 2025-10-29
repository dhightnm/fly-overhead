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
      
      // Wait for size recalculation
      setTimeout(() => {
        // In non-fullscreen mode, we need to pan to shift the view up
        if (!isFullscreen) {
          // Calculate a slight offset north to account for UI elements
          const offsetLat = searchLatlng[0] + 0.003; // Small northward shift
          map.flyTo([offsetLat, searchLatlng[1]], 13, {
            duration: 1.5,
            animate: true
          });
          
          // After animation, fine-tune the position
          setTimeout(() => {
            map.setView([offsetLat, searchLatlng[1]], 13);
          }, 1600);
        } else {
          // Fullscreen mode - normal centering
          map.flyTo(searchLatlng, 13, {
            duration: 1.5,
            animate: true
          });
          
          setTimeout(() => {
            map.setView(searchLatlng, 13);
          }, 1600);
        }
      }, 100);
      
      previousSearchLatlng.current = searchLatlng;
    }
  }, [searchLatlng, map, isFullscreen]);

  return null;
};

export default MapFlyToHandler;