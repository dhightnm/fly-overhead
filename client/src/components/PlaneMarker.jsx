import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import customPlaneIcon from '../assets/plane.png';
import 'leaflet-rotatedmarker';

const PlaneMarker = ({ plane }) => {

    const customIcon = L.icon({
        iconUrl: customPlaneIcon,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, 0],
    });

    const rotationAngle = plane.true_track;

    return (
        <Marker position={[plane.latitude, plane.longitude]} icon={customIcon} rotationAngle={rotationAngle}>
            <Popup>
                {plane.callsign} <br />
                Altitude: {Math.round(plane.baro_altitude * 3.281)}ft <br />
                Speed: {Math.round(plane.velocity * 1.944)}kts <br />
                Heading: {Math.round(plane.true_track)}
            </Popup>
        </Marker>
    );
};

export default PlaneMarker;
