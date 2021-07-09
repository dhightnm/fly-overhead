import React, { useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMapEvents} from 'react-leaflet';
import axios from 'axios';



const Home = () => {

  const [planes, setPlanes] = useState([]);

  function MyComponent() {
    const map = useMapEvents({
      click: () => {
        map.locate()
      },
      locationfound: (location) => {
        console.log('location found:', location)
      },
      moveend: async () => {
        const bounds = map.getBounds();
        const wrapBounds = map.wrapLatLngBounds(bounds);
        // console.log(bounds._southWest.lat, bounds._southWest.lng, bounds._northEast.lat, bounds._northEast.lng);
        console.log(wrapBounds);
        const res = await axios.get(`https://opensky-network.org/api/states/all?lamin=${wrapBounds._southWest.lat}&lomin=${wrapBounds._southWest.lng}&lamax=${wrapBounds._northEast.lat}&lomax=${wrapBounds._northEast.lng}`);
        console.log(res.data);
        setPlanes(res.data.states)
        
      },
    })
    return null
  }

  const renderPlanes = () => {
     return planes.map((plane, i) => {
      console.log(plane[6], plane[5]);
      return <Marker position={[plane[6], plane[5]]}>
        <Popup>{plane[1]}</Popup>
      </Marker>
    })
  };


  const mapRef = useRef(null)

    const position = [46.79, 11.4696]
    return <>
    <MapContainer
      center={position} 
      zoom={8} 
      scrollWheelZoom={true}
      style={{height: 500}}
      ref={mapRef}>
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