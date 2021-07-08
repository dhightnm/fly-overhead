import React from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents} from 'react-leaflet';

function MyComponent() {
  const map = useMapEvents({
    click: () => {
      map.locate()
    },
    locationfound: (location) => {
      console.log('location found:', location)
    },
    zoomend: (e) => {
      console.log(e);
    },
  })
  return null
}

const Home = () => {

    const position = [55, -115.1398]
    return <>
    <MapContainer
      center={position} 
      zoom={8} 
      scrollWheelZoom={true}
      style={{height: 500, width: 900}}>
        <MyComponent />
    <TileLayer
      attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    <Marker position={position}>
      <Popup>
        A pretty CSS3 popup. <br /> Easily customizable.
      </Popup>
    </Marker>
  </MapContainer>
    </>
};

export default Home;