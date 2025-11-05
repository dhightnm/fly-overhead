import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-rotatedmarker';

import planeDefault from '../assets/plane-default.svg';
import planeSmall from '../assets/plane-small.svg';     // category 2
import planeLarge from '../assets/plane-large.svg';     // category 3
import plane757 from '../assets/plane-757.svg';         // category 4
import helicopter from '../assets/helicopter.svg';      // category 7
import glider from '../assets/glider.svg';              // category 8
import drone from '../assets/drone.svg';                // category 13
import military from '../assets/military.svg';          // category 18/19

import './planeMarker.css';

const CATEGORY_ICON_MAP = {
  1: planeDefault,   // Light (no specific icon, using default)
  2: planeSmall,     // Small aircraft
  3: planeLarge,     // Large jet
  4: plane757,        // High vortex large (e.g., B757)
  5: planeDefault,   // Heavy (no specific icon, using default)
  7: helicopter,     // Rotorcraft
  8: glider,         // Glider/sailplane
  9: planeDefault,   // Lighter-than-air (no specific icon, using default)
  11: planeDefault,  // Ultralight/hang-glider/paraglider (no specific icon, using default)
  13: drone,         // Unmanned aerial vehicle
  18: military,      // Military
  19: military,       // Military/Unknown
  default: planeDefault,
};

const CATEGORY_LABEL_MAP = {
  0: 'Unknown type',
  1: 'Light aircraft',
  2: 'Small aircraft',
  3: 'Large jet',
  4: 'High vortex large',
  5: 'Heavy jet',
  6: 'Highly sensitive',
  7: 'Helicopter / Rotorcraft',
  8: 'Glider / Sailplane',
  9: 'Lighter-than-air',
  10: 'Parachutist / Skydiver',
  11: 'Ultralight / Paraglider',
  12: 'Reserved',
  13: 'Drone / UAV',
  14: 'Spacecraft',
  15: 'Emergency vehicle',
  16: 'Service vehicle',
  17: 'Beacon/Static',
  18: 'Military',
  19: 'Military/Unknown',
  default: 'Unknown type',
};

function getIconForPlane(plane) {
  const iconFile = CATEGORY_ICON_MAP[plane.category] || CATEGORY_ICON_MAP.default;
  return L.icon({
    iconUrl: iconFile,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
  });
}

function getCategoryLabel(plane) {
  return CATEGORY_LABEL_MAP[plane.category] || CATEGORY_LABEL_MAP['default'];
}

function getAircraftDisplayType(plane, route) {
  // Prefer aircraft model/type from route data when available
  if (route?.aircraft?.model) {
    return route.aircraft.model;
  }
  if (route?.aircraft?.type) {
    return route.aircraft.type;
  }
  // Fall back to category label
  return getCategoryLabel(plane);
}

const PlaneMarker = ({ plane, route, onMarkerClick }) => {
  if (!plane || plane.latitude === null || plane.latitude === undefined ||
    plane.longitude === null || plane.longitude === undefined) {
    return null;
  }

  const { latitude, longitude, callsign, icao24, baro_altitude, velocity, true_track } = plane;

  return (
    <Marker
      position={[latitude, longitude]}
      icon={getIconForPlane(plane)}
      rotationAngle={true_track || 0}
      eventHandlers={{
        click: () => {
          // Fetch route when marker is clicked
          if (onMarkerClick) {
            onMarkerClick();
          }
        },
        mouseover: () => {
          // Prefetch route data on hover for instant loading when clicked
          if (onMarkerClick && !route) {
            // Trigger prefetch in background (non-blocking)
            onMarkerClick(true).catch(() => {
              // Silently fail - user hasn't clicked yet, so errors don't matter
            });
          }
        }
      }}
    >
      <Popup>
        <div className="plane-popup">
          <div><strong>Callsign:</strong> <span>{callsign || 'N/A'}</span></div>
          <div><strong>ICAO24:</strong> <span>{icao24 || 'N/A'}</span></div>
          <div><strong>Aircraft:</strong> <span>{getAircraftDisplayType(plane, route)}</span></div>
          {route ? (() => {
            const departureCode = route.departureAirport?.icao || route.departureAirport?.iata || route.departureAirport?.name;
            const arrivalCode = route.arrivalAirport?.icao || route.arrivalAirport?.iata || route.arrivalAirport?.name;

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
          })() : (
            <div className="popup-loading">
              <span className="loading-spinner">⏳</span> Loading route details...
            </div>
          )}
          <div><strong>Altitude:</strong> <span>{baro_altitude ? Math.round(baro_altitude * 3.281) + 'ft' : 'N/A'}</span></div>
          <div><strong>Speed:</strong> <span>{velocity ? Math.round(velocity * 1.944) + 'kts' : 'N/A'}</span></div>
          <div><strong>Heading:</strong> <span>{true_track ? Math.round(true_track) : 'N/A'}</span></div>
        </div>
      </Popup>
    </Marker>
  );
};

export default React.memo(PlaneMarker);
