import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

const HeatmapLayer = ({ points, options = {} }) => {
  const map = useMap();

  useEffect(() => {
    if (!points || points.length === 0) return;

    // Convert points to [lat, lng, intensity] format
    const heatData = points.map(point => {
      // Handle different point formats
      if (Array.isArray(point)) {
        // Already in array format [lat, lng, intensity?]
        return point;
      }
      if (point.latitude !== undefined && point.longitude !== undefined) {
        // Object with latitude/longitude properties
        const intensity = point.intensity || point.altitude || 1;
        return [point.latitude, point.longitude, intensity];
      }
      if (point.lat !== undefined && point.lon !== undefined) {
        // Object with lat/lon properties
        const intensity = point.intensity || point.altitude || 1;
        return [point.lat, point.lon, intensity];
      }
      return null;
    }).filter(point => point !== null);

    if (heatData.length === 0) return;

    // Default options
    const heatOptions = {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      max: 1.0,
      gradient: {
        0.0: 'blue',
        0.5: 'lime',
        0.7: 'yellow',
        1.0: 'red'
      },
      ...options
    };

    // Create heatmap layer
    const heatLayer = L.heatLayer(heatData, heatOptions);
    
    // Add to map
    heatLayer.addTo(map);

    // Cleanup on unmount or when points change
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points, options]);

  return null; // This component doesn't render anything directly
};

export default HeatmapLayer;


