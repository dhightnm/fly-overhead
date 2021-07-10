import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

const getIcon = new L.icon({
    iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/BSicon_GENAIR.svg/1920px-BSicon_GENAIR.svg.png',
    iconSize: [50, 50]
});




const PlaneMarker = ( {plane} ) => {
    return <Marker position={[plane[6], plane[5]]} icon={getIcon}>
        <Popup>
           <b> {plane[1]}</b> <br />
           <b> {plane[8] === true ? 'On Ground' : 'In Flight' }</b> <br />
            <b>Altitude:</b> {Math.round(plane[7] * 3.281)}ft <br />
            <b>Speed:</b> {Math.round(plane[9] * 1.944)}kts <br />
            <b>Vertical Rate:</b> {Math.round(plane[11] * 197)}ft/min <br />
            <b>Heading:</b> {Math.round(plane[10])}
        </Popup>
    </Marker>
}

export default PlaneMarker;