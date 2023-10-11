import React, { useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';

const MapEventsHandler = ({ setUserPosition, setPlanes }) => {
  const map = useMapEvents({
    click: () => {
      map.locate();
    },
    locationfound: (location) => {
      setUserPosition(location.latlng);
      map.flyTo(location.latlng, map.getZoom());
    },
    moveend: async () => {
      const bounds = map.getBounds();
      const wrapBounds = map.wrapLatLngBounds(bounds);

      const res = await axios.get(`http://localhost:3001/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`);
      setPlanes(res.data.states);
    },
  });

  return null;
};

const Home = () => {
  const [planes, setPlanes] = useState([]);
  const [userPosition, setUserPosition] = useState(null);
  const [searchLatlng, setSearchLatlng] = useState(null);

  const handleSearch = async (search) => {
    const res = await axios.get(`http://localhost:3001/api/planes/${search}`);
    const allPlanes = res.data.states;

    const foundPlane = allPlanes.find(plane => {
      return plane[0] === search;
    });

    if (foundPlane) {
      setSearchLatlng([foundPlane[6], foundPlane[5]]);
    }
  };

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

  return (
    <>
      <MapContainer center={position} zoom={12} scrollWheelZoom={true} style={{ height: 500 }}>
        <MapEventsHandler setUserPosition={setUserPosition} setPlanes={setPlanes} />
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position}>
          <Popup>
            A pretty CSS3 popup. <br /> Easily customizable.
          </Popup>
        </Marker>

        {renderPlanes()}
      </MapContainer>
    </>
  );
};

export default Home;
