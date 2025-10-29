import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import customPlaneIcon from '../assets/plane.png';
import customPlaneIconGround from '../assets/plane-ground.png';
import 'leaflet-rotatedmarker';

import './planeMarker.css'; // Import a stylesheet for your component

const CUSTOM_ICON = L.icon({
    iconUrl: customPlaneIcon,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
});

const CUSTOM_ICON_GROUND = L.icon({
    iconUrl: customPlaneIconGround,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
});

const PlaneMarker = ({ plane }) => {
    // Add null/undefined checks
    if (!plane || plane.latitude === null || plane.latitude === undefined || 
        plane.longitude === null || plane.longitude === undefined) {
        return null;
    }

    const { latitude, longitude, on_ground, callsign, icao24, baro_altitude, velocity, true_track } = plane;
    
    return (
        <Marker 
            position={[latitude, longitude]} 
            icon={on_ground === true ? CUSTOM_ICON_GROUND : CUSTOM_ICON} 
            rotationAngle={true_track || 0}
        >
            <Popup>
                <div className="plane-popup">
                    <div><strong>Callsign:</strong> <span>{callsign || 'N/A'}</span></div>
                    <div><strong>ICAO24:</strong> <span>{icao24 || 'N/A'}</span></div>
                    <div><strong>Altitude:</strong> <span>{baro_altitude ? Math.round(baro_altitude * 3.281) + 'ft' : 'N/A'}</span></div>
                    <div><strong>Speed:</strong> <span>{velocity ? Math.round(velocity * 1.944) + 'kts' : 'N/A'}</span></div>
                    <div><strong>Heading:</strong> <span>{true_track ? Math.round(true_track) : 'N/A'}</span></div>
                </div>
            </Popup>
        </Marker>
    );
};

export default React.memo(PlaneMarker);
