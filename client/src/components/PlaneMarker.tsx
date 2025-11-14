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

const MS_TO_FPM = 196.850394;

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
  isLoading?: boolean;
  onMarkerClick?: (isPrefetch?: boolean) => Promise<void> | void;
}

function getIconForPlane(plane: Aircraft, route?: Route, categoryOverride?: number) {
  // Priority order for category:
  // 1. categoryOverride (from inferAircraftCategory)
  // 2. route.aircraft?.category (from backend, most reliable)
  // 3. plane.category (from aircraft_states, may be unreliable)
  // 4. default
  const routeCategory = route?.aircraft?.category;
  const derivedCategory = categoryOverride ?? routeCategory ?? inferAircraftCategory(plane, route);
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
  // If we have model from route, show it (preferred)
  if (route?.aircraft?.model) {
    // If type is not "Plane" (generic) and different from model, show "Model - Type"
    if (route?.aircraft?.type && 
        route.aircraft.type !== 'Plane' && 
        route.aircraft.type !== route.aircraft.model) {
      return `${route.aircraft.model} - ${route.aircraft.type}`;
    }
    // Otherwise just show model (don't show redundant "EA50 - EA50")
    return route.aircraft.model;
  }
  // If we only have type (ICAO code), show it (but skip if it's just "Plane")
  if (route?.aircraft?.type && route.aircraft.type !== 'Plane') {
    return route.aircraft.type;
  }
  if (plane.aircraft_description) {
    return plane.aircraft_description;
  }
  if (plane.model) {
    return plane.model;
  }
  if (plane.aircraft_model) {
    return plane.aircraft_model;
  }
  if (plane.aircraft_type && plane.aircraft_type !== 'Plane') {
    return plane.aircraft_type;
  }
  // Fallback to category label
  return getCategoryLabel(plane);
}

function formatVerticalRateValue(verticalRate?: number | null) {
  if (verticalRate === null || verticalRate === undefined) {
    return 'N/A';
  }
  const fpm = Math.round(verticalRate * MS_TO_FPM);
  const prefix = fpm > 0 ? '+' : '';
  return `${prefix}${fpm.toLocaleString()} fpm`;
}

const PlaneMarker: React.FC<PlaneMarkerProps> = ({
  plane,
  route,
  categoryOverride,
  isSelected = false,
  isHighlighted = false,
  isLoading = false,
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

  const { latitude, longitude, callsign, icao24, baro_altitude, velocity, true_track, isStale, ageMinutes, data_age_seconds, position_source, registration, vertical_rate } = plane;
  const zIndexOffset = isSelected ? 1000 : isHighlighted ? 800 : 0;
  
  // Calculate staleness
  const dataAgeMinutes = data_age_seconds ? Math.floor(data_age_seconds / 60) : 0;
  const isDataStale = data_age_seconds ? data_age_seconds > 5 * 60 : false; // >5 minutes is stale
  const isDataVeryStale = data_age_seconds ? data_age_seconds > 10 * 60 : false; // >10 minutes is very stale
  
  // Reduce opacity for stale aircraft
  let opacity = isSelected || isHighlighted ? 1 : 0.95;
  if (isStale || isDataVeryStale) {
    opacity = isSelected || isHighlighted ? 0.7 : 0.5;
  } else if (isDataStale) {
    opacity = isSelected || isHighlighted ? 0.85 : 0.75;
  }

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
          {(isStale || isDataStale) && (
            <div style={{ 
              backgroundColor: isDataVeryStale ? '#f8d7da' : '#fff3cd', 
              color: isDataVeryStale ? '#721c24' : '#856404', 
              padding: '4px 8px', 
              marginBottom: '8px', 
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 'bold'
            }}>
              {isDataVeryStale ? '⛔' : '⚠️'} {isDataVeryStale ? 'VERY OLD' : 'STALE'} DATA ({dataAgeMinutes || ageMinutes}min old)
              {position_source && position_source !== 'websocket' && (
                <span style={{ marginLeft: '4px', fontSize: '10px', opacity: 0.8 }}>
                  • {position_source}
                </span>
              )}
            </div>
          )}
          {isLoading && (
            <div style={{ 
              backgroundColor: '#e3f2fd', 
              color: '#1976d2', 
              padding: '4px 8px', 
              marginBottom: '8px', 
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 'bold'
            }}>
              ⏳ Fetching latest flight data...
            </div>
          )}
          <div>
            <strong>Callsign:</strong> <span>{route?.callsign || callsign || 'N/A'}</span>
            {plane.data_source === 'feeder' && (
              <span style={{ marginLeft: '8px', color: '#22c55e', fontSize: '12px' }} title="Data from local feeder">
                🟢 Feeder
              </span>
            )}
          </div>
          <div>
            <strong>ICAO24:</strong> <span>{icao24 || 'N/A'}</span>
          </div>
          <div>
            <strong>Aircraft:</strong>{' '}
            {isLoading || !route ? (
              <span className="loading-spinner">⏳</span>
            ) : (
              <span>{getAircraftDisplayType(plane, route)}</span>
            )}
          </div>
          {isLoading ? (
            <div className="popup-loading">
              <span className="loading-spinner">⏳</span> Loading route details...
            </div>
          ) : !route ? (
            <div className="popup-loading">
              <span className="loading-spinner">⏳</span> Loading route details...
            </div>
          ) : (
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
          )}
          <div>
            <strong>Altitude:</strong>{' '}
            <span>{baro_altitude ? `${Math.round(baro_altitude * 3.281)}ft` : 'N/A'}</span>
          </div>
          <div>
            <strong>Speed:</strong>{' '}
            <span>
              {velocity || velocity === 0
                ? `${Math.round(velocity).toLocaleString()} kts`
                : 'N/A'}
            </span>
          </div>
          <div>
            <strong>Vertical Rate:</strong>{' '}
            <span>{formatVerticalRateValue(vertical_rate)}</span>
          </div>
          <div>
            <strong>Heading:</strong>{' '}
            <span>{true_track ? Math.round(true_track) : 'N/A'}</span>
          </div>
          {registration && (
            <div>
              <strong>Registration:</strong> <span>{registration}</span>
            </div>
          )}
        </div>
      </Popup>
    </Marker>
  );
};

export default React.memo(PlaneMarker);
