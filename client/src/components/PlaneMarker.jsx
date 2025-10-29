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

const PlaneMarker = ({ plane, route }) => {
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
                    {route && (() => {
                      const departureCode = route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name;
                      const arrivalCode = route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name;
                      
                      // Show route if we have any airport codes OR if both locations exist (inferred route)
                      if (departureCode || arrivalCode || (route.departureAirport?.location && route.arrivalAirport?.location)) {
                        return (
                          <div className="popup-route">
                            <div><strong>From:</strong> <span>
                              {departureCode || (route.departureAirport?.inferred ? 'Unknown' : 'N/A')}
                            </span></div>
                            <div><strong>To:</strong> <span>
                              {arrivalCode || (route.arrivalAirport?.inferred ? 'Unknown' : 'N/A')}
                            </span></div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <div><strong>Altitude:</strong> <span>{baro_altitude ? Math.round(baro_altitude * 3.281) + 'ft' : 'N/A'}</span></div>
                    <div><strong>Speed:</strong> <span>{velocity ? Math.round(velocity * 1.944) + 'kts' : 'N/A'}</span></div>
                    <div><strong>Heading:</strong> <span>{true_track ? Math.round(true_track) : 'N/A'}</span></div>
                </div>
            </Popup>
        </Marker>
    );
};

export default React.memo(PlaneMarker);
