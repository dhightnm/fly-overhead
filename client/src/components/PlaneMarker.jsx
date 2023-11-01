import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import customPlaneIcon from '../assets/plane.png';
import 'leaflet-rotatedmarker';

import './planeMarker.css'; // Import a stylesheet for your component

const CUSTOM_ICON = L.icon({
    iconUrl: customPlaneIcon,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
});

const PlaneMarker = ({ plane: { latitude, longitude, callsign, icao24, baro_altitude, velocity, true_track } }) => {
    return (
        <Marker position={[latitude, longitude]} icon={CUSTOM_ICON} rotationAngle={true_track}>
            <Popup>
                <div className="plane-popup">
                    <div><strong>Callsign:</strong> <span>{callsign}</span></div>
                    <div><strong>ICAO24:</strong> <span>{icao24}</span></div>
                    <div><strong>Altitude:</strong> <span>{Math.round(baro_altitude * 3.281)}ft</span></div>
                    <div><strong>Speed:</strong> <span>{Math.round(velocity * 1.944)}kts</span></div>
                    <div><strong>Heading:</strong> <span>{Math.round(true_track)}</span></div>
                </div>
            </Popup>
        </Marker>
    );
};

export default PlaneMarker;
