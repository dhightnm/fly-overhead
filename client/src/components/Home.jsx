import React, { useState, useContext, useEffect, useCallback } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';
import SatMarker from './SatMarker';
import { PlaneContext } from '../contexts/PlaneContext';
import MapFlyToHandler from './MapFlyToHandler';
// Import your CSS
import './home.css';

const MapEventsHandler = ({ setUserPosition, setPlanes, setStarlink }) => {
  const API_URL = "http://localhost:3005";
  
  const fetchData = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    
    const bounds = map.getBounds();
    const wrapBounds = map.wrapLatLngBounds(bounds);
    const center = map.getCenter();
    const seaLevel = 0;

    // Fetch starlink data
    try {
      const satRes = await axios.get(
        `${API_URL}/api/starlink/${center.lat}/${center.lng}/${seaLevel}/`
      );
      if (satRes.data && satRes.data.above) {
        setStarlink(satRes.data.above);
      } else {
        console.log('no starlink found');
        setStarlink([]);
      }
    } catch (error) {
      console.error('Error fetching starlink data:', error);
    }

    // Fetch plane data
    try {
      const res = await axios.get(
        `${API_URL}/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`
      );
      if (res.data) {
        setPlanes(res.data);
      } else {
        console.log('no planes found');
      }
    } catch (error) {
      console.error('Error fetching plane data:', error);
    }
  }, [API_URL, setPlanes, setStarlink]);

  const mapRef = React.useRef(null);
  const map = useMapEvents({
    load: async () => {
      const loadCenter = map.locate().getCenter();
      loadCenter();
      try {
        const res = await axios.get(`${API_URL}/api/area/all`);
        if (res.data) {
          setPlanes(res.data);
        } else { 
          console.log('no planes found');
        }
      } catch (error) {
        console.error('Error fetching initial plane data:', error);
      }
    },
    click: () => {},
    locationfound: (location) => {
      setUserPosition(location.latlng);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: async () => {
      // fetch data whenever the map finishes moving
      await fetchData();
    }
  });

  mapRef.current = map;

  useEffect(() => {
    // Fire the fetchData on an interval to keep the data fresh
    const interval = setInterval(() => {
      fetchData();
      console.log("Data fetched on interval");
    }, 15 * 1000);

    return () => clearInterval(interval);
  }, [fetchData]);

  return null;
};

const Home = () => {
  const [planes, setPlanes] = useState([]);
  const [starlink, setStarlink] = useState([]);
  const [userPosition, setUserPosition] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;
  const position = searchLatlng || [35.104795500039565, -106.62620902061464];

  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const renderPlanes = () => {
    if (!planes || planes.length === 0) {
      return <p>No planes to display.</p>;
    }

    return planes.map((plane) => {
      // Show only planes that are flying
      if (plane.velocity > 2) {
        return <PlaneMarker key={plane.id} plane={plane} />;
      }
      return null;
    });
  };

  const renderStarlink = () => {
    if (!starlink || starlink.length === 0) {
      return <p>No starlink to display.</p>;
    }

    return starlink.map((sat) => {
      if (sat[6] !== null) {
        return <SatMarker key={sat.satid || sat.id} sat={sat} />;
      }
      return null;
    });
  };

  return (
    <div className="home-container">
      <button className="fullscreen-button" onClick={handleToggleFullscreen}>
        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </button>
      <div className={isFullscreen ? 'map-fullscreen' : 'map-regular'}>
        <MapContainer
          center={position}
          zoom={12}
          scrollWheelZoom
        >
          
          <MapEventsHandler
            setUserPosition={setUserPosition}
            setPlanes={setPlanes}
            setStarlink={setStarlink}
          />
          <MapFlyToHandler searchLatlng={searchLatlng} />
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
        </MapContainer>
      </div>
    </div>
  );
};

export default Home;
