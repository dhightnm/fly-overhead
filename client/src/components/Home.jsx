import React, { useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents} from 'react-leaflet';
import axios from 'axios';
import PlaneMarker from './PlaneMarker';



const Home = () => {

  const [planes, setPlanes] = useState([]);
  const [userPosition, setUserPosition] = useState(null)
  
  
  function MyComponent() {
    const map = useMapEvents({
      click: () => {
        map.locate();
        console.log(map.locate());
      },
      locationfound: (location) => {
        setUserPosition(location.latlng);
        map.flyTo(location.latlng, map.getZoom())
        console.log(userPosition);
        console.log('location found:', location)
      },
      moveend: async () => {
        const bounds = map.getBounds();
        console.log(bounds);
        const wrapBounds = map.wrapLatLngBounds(bounds);
        // console.log(wrapBounds._southWest.lat, wrapBounds._southWest.lng, wrapBounds._northEast.lat, wrapBounds._northEast.lng);

        const res = await axios.get(`http://localhost:3001/api/area/${wrapBounds._southWest.lat}/${wrapBounds._southWest.lng}/${wrapBounds._northEast.lat}/${wrapBounds._northEast.lng}`);
        console.log(res.data);
        setPlanes(res.data.states)
        
      },
    })
    return null
  }

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
  
    const position = [35.1858, -106.8107]
    return <>
    <MapContainer
      center={position} 
      zoom={12} 
      scrollWheelZoom={true}
      style={{height: 500}}>
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
    
    {renderPlanes()}
  </MapContainer>
    </>
};

export default Home;