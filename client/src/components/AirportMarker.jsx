import React, { useState } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useAuth } from "../contexts/AuthContext";
import "./airportMarker.css";

// Create custom airport icons based on airport type
const AIRPORT_ICONS = {
  large_airport: L.divIcon({
    className: "airport-marker-large",
    html: '<div class="airport-icon">✈</div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  }),
  medium_airport: L.divIcon({
    className: "airport-marker-medium",
    html: '<div class="airport-icon">✈</div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  }),
  small_airport: L.divIcon({
    className: "airport-marker-small",
    html: '<div class="airport-icon">✈</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  }),
  heliport: L.divIcon({
    className: "airport-marker-heliport",
    html: '<div class="airport-icon">Ⓗ</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  }),
  seaplane_base: L.divIcon({
    className: "airport-marker-seaplane",
    html: '<div class="airport-icon">⚓</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  }),
  default: L.divIcon({
    className: "airport-marker-default",
    html: '<div class="airport-icon">✈</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  }),
};

const AirportMarker = ({ airport, onAirportClick }) => {
  const { isPremium, isEFB } = useAuth();
  const [showFrequencies, setShowFrequencies] = useState(false);

  if (!airport || !airport.latitude_deg || !airport.longitude_deg) {
    return null;
  }

  const {
    latitude_deg,
    longitude_deg,
    ident,
    gps_code,
    name,
    type,
    iata_code,
    municipality,
    iso_country,
    elevation_ft,
    runways,
    frequencies,
  } = airport;

  const hasPremiumAccess = isPremium() || isEFB();

  // Select appropriate icon based on airport type
  const icon = AIRPORT_ICONS[type] || AIRPORT_ICONS.default;

  // Get longest runway
  const longestRunway =
    runways && runways.length > 0
      ? runways.reduce(
          (max, runway) =>
            runway.length_ft > (max?.length_ft || 0) ? runway : max,
          runways[0]
        )
      : null;

  // Get tower frequency
  const towerFreq =
    frequencies && frequencies.length > 0
      ? frequencies.find((f) => f.type === "TWR")
      : null;

  const handleClick = () => {
    if (onAirportClick) {
      onAirportClick(airport);
    }
  };

  return (
    <Marker
      position={[latitude_deg, longitude_deg]}
      icon={icon}
      eventHandlers={{
        click: handleClick,
      }}
    >
      <Popup maxWidth={300}>
        <div className="airport-popup">
          <div className="airport-popup-header">
            <h3>{name}</h3>
            <div className="airport-codes">
              {(iata_code || airport.iata) && (
                <span className="iata-code">{iata_code || airport.iata}</span>
              )}
              <span className="icao-code">
                {gps_code ||
                  ident ||
                  airport.gps_code ||
                  airport.icao ||
                  airport.ident}
              </span>
            </div>
          </div>

          <div className="airport-popup-body">
            <div className="airport-info-row">
              <span className="label">Location:</span>
              <span className="value">
                {municipality && `${municipality}, `}
                {iso_country}
              </span>
            </div>

            {elevation_ft && (
              <div className="airport-info-row">
                <span className="label">Elevation:</span>
                <span className="value">
                  {elevation_ft.toLocaleString()} ft
                </span>
              </div>
            )}

            <div className="airport-info-row">
              <span className="label">Type:</span>
              <span className="value">{type?.replace(/_/g, " ")}</span>
            </div>

            {longestRunway && (
              <div className="airport-info-row">
                <span className="label">Longest Runway:</span>
                <span className="value">
                  {longestRunway.low_end?.ident && longestRunway.high_end?.ident
                    ? `${longestRunway.low_end.ident}/${longestRunway.high_end.ident}`
                    : longestRunway.low_end?.ident ||
                      longestRunway.high_end?.ident ||
                      "N/A"}{" "}
                  - {longestRunway.length_ft?.toLocaleString()} ft
                  {longestRunway.surface && ` (${longestRunway.surface})`}
                </span>
              </div>
            )}

            {runways && runways.length > 0 && (
              <div className="airport-info-row">
                <span className="label">Total Runways:</span>
                <span className="value">{runways.length}</span>
              </div>
            )}

            {towerFreq && (
              <div className="airport-info-row">
                <span className="label">Tower:</span>
                <span className="value">{towerFreq.frequency_mhz} MHz</span>
              </div>
            )}

            {frequencies && frequencies.length > 0 && (
              <div className="airport-info-row">
                <span className="label">Frequencies:</span>
                {hasPremiumAccess ? (
                  <div className="frequency-dropdown">
                    <button
                      type="button"
                      className="frequency-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFrequencies(!showFrequencies);
                      }}
                    >
                      {frequencies.length} available ▼
                    </button>
                    {showFrequencies && (
                      <div className="frequency-list">
                        {frequencies.map((freq, idx) => (
                          <div key={idx} className="frequency-item">
                            <span className="frequency-type">
                              {freq.type || "N/A"}:
                            </span>
                            <span className="frequency-value">
                              {freq.frequency_mhz} MHz
                            </span>
                            {freq.description && (
                              <span className="frequency-desc">
                                {" "}
                                - {freq.description}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="value">
                    {frequencies.length} available{" "}
                    <span className="premium-badge">Premium/EFB</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="airport-popup-footer">
            <span className="coordinates">
              {latitude_deg.toFixed(4)}, {longitude_deg.toFixed(4)}
            </span>
          </div>
        </div>
      </Popup>
    </Marker>
  );
};

export default React.memo(AirportMarker);
