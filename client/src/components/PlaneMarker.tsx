import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-rotatedmarker';

import planeDefault from '../assets/plane-default.svg';
import planeSmall from '../assets/plane-small.svg';
import planeLarge from '../assets/plane-large.svg';
import plane757 from '../assets/plane-757.svg';
import helicopter from '../assets/helicopter.svg';
import glider from '../assets/glider.svg';
import drone from '../assets/drone.svg';
import military from '../assets/military.svg';

import './planeMarker.css';
import { inferAircraftCategory } from '../utils/aircraft';
import type { Aircraft, Route } from '../types';

const CATEGORY_ICON_MAP: Record<number | 'default', string> = {
  1: planeDefault,
  2: planeSmall,
  3: planeLarge,
  4: plane757,
  5: planeDefault,
  7: helicopter,
  8: glider,
  9: planeDefault,
  11: planeDefault,
  13: drone,
  18: military,
  19: military,
  default: planeDefault,
};

const CATEGORY_LABEL_MAP: Record<number | 'default', string> = {
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

interface PlaneMarkerProps {
  plane: Aircraft;
  route?: Route;
  categoryOverride?: number;
  isSelected?: boolean;
  isHighlighted?: boolean;
  onMarkerClick?: (isPrefetch?: boolean) => Promise<void> | void;
}

function getIconForPlane(plane: Aircraft, route?: Route, categoryOverride?: number) {
  const derivedCategory = categoryOverride ?? inferAircraftCategory(plane, route);
  const categoryKey = derivedCategory ?? plane.category ?? 'default';
  const iconFile = CATEGORY_ICON_MAP[categoryKey] || CATEGORY_ICON_MAP.default;
  return L.icon({
    iconUrl: iconFile,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, 0],
  });
}

function getCategoryLabel(plane: Aircraft) {
  return CATEGORY_LABEL_MAP[plane.category ?? 'default'] || CATEGORY_LABEL_MAP.default;
}

function getAircraftDisplayType(plane: Aircraft, route?: Route) {
  if (route?.aircraft?.model) {
    return route.aircraft.model;
  }
  if (route?.aircraft?.type) {
    return route.aircraft.type;
  }
  return getCategoryLabel(plane);
}

const PlaneMarker: React.FC<PlaneMarkerProps> = ({
  plane,
  route,
  categoryOverride,
  isSelected = false,
  isHighlighted = false,
  onMarkerClick,
}) => {
  if (
    !plane ||
    plane.latitude === null ||
    plane.latitude === undefined ||
    plane.longitude === null ||
    plane.longitude === undefined
  ) {
    return null;
  }

  const { latitude, longitude, callsign, icao24, baro_altitude, velocity, true_track } = plane;
  const zIndexOffset = isSelected ? 1000 : isHighlighted ? 800 : 0;
  const opacity = isSelected || isHighlighted ? 1 : 0.95;

  return (
    <Marker
      position={[latitude, longitude]}
      icon={getIconForPlane(plane, route, categoryOverride)}
      // @ts-ignore - provided by leaflet-rotatedmarker plugin
      rotationAngle={true_track || 0}
      zIndexOffset={zIndexOffset}
      opacity={opacity}
      eventHandlers={{
        click: () => {
          if (onMarkerClick) {
            onMarkerClick();
          }
        },
        mouseover: () => {
          if (onMarkerClick && !route) {
            const maybePromise = onMarkerClick(true);
            if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
              (maybePromise as Promise<void>).catch(() => {});
            }
          }
        },
      }}
    >
      <Popup>
        <div className="plane-popup">
          <div>
            <strong>Callsign:</strong> <span>{callsign || 'N/A'}</span>
          </div>
          <div>
            <strong>ICAO24:</strong> <span>{icao24 || 'N/A'}</span>
          </div>
          <div>
            <strong>Aircraft:</strong> <span>{getAircraftDisplayType(plane, route)}</span>
          </div>
          {route ? (
            (() => {
              const departureCode =
                route.departureAirport?.icao ||
                route.departureAirport?.iata ||
                route.departureAirport?.name;
              const arrivalCode =
                route.arrivalAirport?.icao ||
                route.arrivalAirport?.iata ||
                route.arrivalAirport?.name;

              if (
                departureCode ||
                arrivalCode ||
                (route.departureAirport?.location && route.arrivalAirport?.location)
              ) {
                return (
                  <div className="popup-route">
                    <div>
                      <strong>From:</strong>{' '}
                      <span>
                        {departureCode ||
                          (route.departureAirport?.inferred ? 'Unknown' : 'N/A')}
                      </span>
                    </div>
                    <div>
                      <strong>To:</strong>{' '}
                      <span>
                        {arrivalCode ||
                          (route.arrivalAirport?.inferred ? 'Unknown' : 'N/A')}
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            })()
          ) : (
            <div className="popup-loading">
              <span className="loading-spinner">⏳</span> Loading route details...
            </div>
          )}
          <div>
            <strong>Altitude:</strong>{' '}
            <span>{baro_altitude ? `${Math.round(baro_altitude * 3.281)}ft` : 'N/A'}</span>
          </div>
          <div>
            <strong>Speed:</strong>{' '}
            <span>{velocity ? `${Math.round(velocity * 1.944)}kts` : 'N/A'}</span>
          </div>
          <div>
            <strong>Heading:</strong>{' '}
            <span>{true_track ? Math.round(true_track) : 'N/A'}</span>
          </div>
        </div>
      </Popup>
    </Marker>
  );
};

export default React.memo(PlaneMarker);
