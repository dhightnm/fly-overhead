import React from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';


const Home = () => {
    const position = [36.1699, -115.1398]
    return <>
    <MapContainer center={position} zoom={13} scrollWheelZoom={true} style={{height: 500}}>
    <TileLayer
      attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    <Marker position={position}>
      <Popup>
        A pretty CSS3 popup. <br /> Easily customizable.
      </Popup>
    </Marker>
  </MapContainer>,
    </>
};

export default Home;