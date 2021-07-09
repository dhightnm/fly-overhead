import React from 'react';
import { Marker, Popup } from 'react-leaflet';

const PlaneMarker = ( {plane} ) => {
    return <Marker position={[plane[6], plane[5]]}>
        <Popup>
            {plane[1]} <br />
            Altitude: {Math.round(plane[7] * 3.281)}ft <br />
            Speed: {Math.round(plane[9] * 1.944)}kts <br />
            Heading: {Math.round(plane[10])}
        </Popup>
    </Marker>
}

export default PlaneMarker;