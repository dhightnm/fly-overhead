import React, { useState, useContext, useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';
import SatMarker from './SatMarker';
import { PlaneContext } from '../contexts/PlaneContext';
import MapFlyToHandler from './MapFlyToHandler';
// Import your CSS
import './home.css';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.REACT_APP_PORT || 3001;

const MapEventsHandler = ({ setUserPosition, setPlanes, setStarlink }) => {
  const REACT_APP_FLY_OVERHEAD_API_URL= process.env.REACT_APP_API_URL || `http://localhost:${PORT}`;
  const map = useMapEvents({
    load: () => {
      const loadCenter = map.locate().getCenter();
      loadCenter();
      const res = axios.get(`${REACT_APP_FLY_OVERHEAD_API_URL}/api/area/all`);
      if (res.data) {
        setPlanes(res.data);
      } else { 
        console.log('no planes found');
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

  const fetchData = async () => {
    const bounds = map.getBounds();
    const wrapBounds = map.wrapLatLngBounds(bounds);
    const center = map.getCenter();
    const seaLevel = 0;

    // Fetch starlink data
    const satRes = await axios.get(
      `${REACT_APP_FLY_OVERHEAD_API_URL}/api/starlink/${center.lat}/${center.lng}/${seaLevel}/`
    );
    if (satRes.data && satRes.data.above) {
      setStarlink(satRes.data.above);
    } else {
      console.log('no starlink found');
      setStarlink([]);
    }

    // Fetch plane data
    const res = await axios.get(
      `${REACT_APP_FLY_OVERHEAD_API_URL}/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`
    );
    if (res.data) {
      setPlanes(res.data);
    } else {
      console.log('no planes found');
    }
  };

  useEffect(() => {
    // Fire the fetchData on an interval to keep the data fresh
    const interval = setInterval(() => {
      fetchData();
      console.log("Data fetched on interval");
    }, 15 * 1000);

    return () => clearInterval(interval);
  }, []); // run once on mount

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
