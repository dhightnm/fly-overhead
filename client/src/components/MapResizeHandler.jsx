import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

const MapResizeHandler = ({ sidebarOpen }) => {
  const map = useMap();

  useEffect(() => {
    // Wait for CSS transition to complete before invalidating
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 350); // Match CSS transition duration (0.3s) + buffer

    return () => clearTimeout(timer);
  }, [sidebarOpen, map]);

  return null;
};

export default MapResizeHandler;

