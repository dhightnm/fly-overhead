import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import customPlaneIcon from '../assets/plane.png';

const SatMarker = ({ plane }) => {

    return (
        <Marker position={[plane.latitude, plane.longitude]}>
            <Popup>
                {plane.callsign} <br />
                Altitude: {Math.round(plane.baro_altitude * 3.281)}ft <br />
                Speed: {Math.round(plane.velocity * 1.944)}kts <br />
                Heading: {Math.round(plane.true_track)}
            </Popup>
        </Marker>
    );
};

export default SatMarker;