import React, { useState, useContext, useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';
import SatMarker from './SatMarker';
import { PlaneContext } from '../contexts/PlaneContext';
import MapFlyToHandler from './MapFlyToHandler';


const MapEventsHandler = ({ setUserPosition, setPlanes, setStarlink }) => {

  const fetchData = async () => {
    const bounds = map.getBounds();
    const wrapBounds = map.wrapLatLngBounds(bounds);
    const center = map.getCenter();
    const seaLevel = 5;

    // Fetch starlink data
    const satRes = await axios.get(`http://localhost:3001/api/starlink/${center.lat}/${center.lng}/${seaLevel}/`);
    if (satRes.data) {
      setStarlink(satRes.data.above);
    } else {
      console.log('no starlink found');
    }

    // Fetch plane data
    const res = await axios.get(`http://localhost:3001/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`);
    if (res.data) {
      setPlanes(res.data);
    } else {
      console.log('no planes found');
    }
}

  // Inside MapEventsHandler component
  useEffect(() => {
    const interval = setInterval(() => {
        fetchData();
    }, 10000); // Fetch data every 10 seconds

    return () => clearInterval(interval); // Cleanup when the component is unmounted
  });


  const map = useMapEvents({
    load: () => {
      const loadCenter = map.locate().getCenter();
      loadCenter();
      const res = axios.get('http://localhost:3001/api/area/all');
      if (res.data) {
        setPlanes(res.data);
      } else { console.log('no planes found');}
    },
    click: () => {
    },
    locationfound: (location) => {
      setUserPosition(location.latlng);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: fetchData
  });

  return null;
};

const Home = () => {
  const [planes, setPlanes] = useState([]);
  const [starlink, setStarlink] = useState([]);
  const [userPosition, setUserPosition] = useState(null);

  const contextValue = useContext(PlaneContext);
  const searchLatlng = contextValue ? contextValue.searchLatlng : userPosition;

  const renderPlanes = () => {
    if (planes === null) {
      return null;
    }

    if (planes.length === 0) {
      return <p>No planes to display.</p>;
    }

    return planes.map((plane, i) => {
      if (plane[6] !== null) {
        return <PlaneMarker key={i} plane={plane} />;
      }
      return null;
    });
  };

  const position = searchLatlng || [35.1858, -106.8107];

  const renderStarlink = () => {
    if (starlink === null) {
      return null;
    }

    if (starlink.length === 0) {
      return <p>No starlink to display.</p>;
    }

    return starlink.map((sat, i) => {
      if (sat[6] !== null) {
        return <SatMarker key={i} sat={sat} />;
      }
      return null;
    });
  }


  return (
    <>
      <MapContainer center={position} zoom={12} scrollWheelZoom={true} style={{ height: 500 }}>
        <MapEventsHandler setUserPosition={setUserPosition} setPlanes={setPlanes} setStarlink={setStarlink} />
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
    </>
  );
};

export default Home;
