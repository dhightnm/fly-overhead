import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import customPlaneIcon from '../assets/plane.png';

const PlaneMarker = ({ plane }) => {

    const customIcon = L.icon({
        iconUrl: customPlaneIcon,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, 0],
    });

    const rotationAngle = plane[10];

    return (
        <Marker position={[plane[6], plane[5]]} icon={customIcon} rotationAngle={rotationAngle}>
            <Popup>
                {plane[1]} <br />
                Altitude: {Math.round(plane[7] * 3.281)}ft <br />
                Speed: {Math.round(plane[9] * 1.944)}kts <br />
                Heading: {Math.round(plane[10])}
            </Popup>
        </Marker>
    );
};

export default PlaneMarker;