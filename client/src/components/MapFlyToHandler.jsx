import { useMap } from 'react-leaflet';
import { useEffect } from 'react';

const MapFlyToHandler = ({ searchLatlng }) => {
  const map = useMap();
  console.log('Received latlng in MapFlyToHandler:', searchLatlng);


  useEffect(() => {
    console.log('Updated searchLatlng in MapFlyToHandler:', searchLatlng);
    if (searchLatlng) {
        map.flyTo(searchLatlng, 12);
    }
}, [searchLatlng, map]);

  return null;
};

export default MapFlyToHandler;