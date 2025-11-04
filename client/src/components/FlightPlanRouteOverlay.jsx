import React from 'react';
import { Polyline, Popup, CircleMarker } from 'react-leaflet';

/**
 * FlightPlanRouteOverlay Component
 * 
 * Displays the filed flight plan route as waypoints connected by a polyline.
 * Uses waypoint coordinates from the navaids/airports lookup.
 */
const FlightPlanRouteOverlay = ({ flightPlanRoute, showWaypoints = true }) => {
  if (!flightPlanRoute || !flightPlanRoute.waypoints || flightPlanRoute.waypoints.length === 0) {
    return null;
  }

  const { waypoints, routeString, callsign } = flightPlanRoute;

  // Create polyline path from waypoints
  // Filter out any invalid coordinates and log them for debugging
  const polylinePositions = waypoints
    .filter(wp => {
      const valid = wp.latitude != null && wp.longitude != null &&
                    !isNaN(wp.latitude) && !isNaN(wp.longitude) &&
                    wp.latitude >= -90 && wp.latitude <= 90 &&
                    wp.longitude >= -180 && wp.longitude <= 180;
      if (!valid) {
        console.warn('Invalid waypoint coordinates:', wp);
      }
      return valid;
    })
    .map(wp => [wp.latitude, wp.longitude]);
  
  if (polylinePositions.length === 0) {
    console.warn('No valid waypoint positions for route overlay', { waypoints, routeString, callsign });
    return null;
  }

  // Color for flight plan route (different from actual flight path)
  const routeColor = '#ff6b00'; // Orange to distinguish from actual path
  const routeOpacity = 0.7;

  return (
    <>
      {/* Draw polyline connecting waypoints */}
      {polylinePositions.length > 1 && (
        <Polyline
          positions={polylinePositions}
          color={routeColor}
          weight={3}
          opacity={routeOpacity}
          dashArray="10, 5" // Dashed line to indicate planned route
        />
      )}

      {/* Draw waypoint markers */}
      {showWaypoints && waypoints
        .filter(wp => wp.latitude != null && wp.longitude != null &&
                     !isNaN(wp.latitude) && !isNaN(wp.longitude) &&
                     wp.latitude >= -90 && wp.latitude <= 90 &&
                     wp.longitude >= -180 && wp.longitude <= 180)
        .map((waypoint, index, filteredArray) => {
        const isFirst = index === 0;
        const isLast = index === filteredArray.length - 1;
        
        // Use different colors for start/end/middle waypoints
        let markerColor = '#666'; // Default gray for intermediate waypoints
        let radius = 6;
        
        if (isFirst) {
          markerColor = '#4caf50'; // Green for departure
          radius = 8;
        } else if (isLast) {
          markerColor = '#f44336'; // Red for arrival
          radius = 8;
        }

        return (
          <CircleMarker
            key={`${waypoint.code}-${index}`}
            center={[waypoint.latitude, waypoint.longitude]}
            radius={radius}
            pathOptions={{
              color: markerColor,
              fillColor: markerColor,
              fillOpacity: 0.8,
              weight: 2,
            }}
          >
            <Popup>
              <div className="waypoint-popup">
                <div><strong>Waypoint {index + 1}:</strong> {waypoint.code}</div>
                {waypoint.name && <div><strong>Name:</strong> {waypoint.name}</div>}
                <div><strong>Type:</strong> {waypoint.type || 'Unknown'}</div>
                {routeString && <div><strong>Route:</strong> {routeString}</div>}
                {callsign && <div><strong>Flight:</strong> {callsign}</div>}
                <div><strong>Position:</strong> {waypoint.latitude.toFixed(4)}, {waypoint.longitude.toFixed(4)}</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
};

export default FlightPlanRouteOverlay;

