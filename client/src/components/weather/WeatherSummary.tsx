import React from 'react';
import type { WeatherSummary as WeatherSummaryType } from '../../services/weather.service';
import './WeatherSummary.css';

interface WeatherSummaryProps {
  weather: WeatherSummaryType;
  loading?: boolean;
}

const WeatherSummary: React.FC<WeatherSummaryProps> = ({ weather, loading }) => {
  if (loading) {
    return (
      <div className="weather-summary">
        <div className="weather-loading">Loading weather data...</div>
      </div>
    );
  }

  if (!weather.current && !weather.forecast) {
    return (
      <div className="weather-summary">
        <div className="weather-unavailable">No weather data available</div>
      </div>
    );
  }

  const formatWind = (dir?: number, speed?: number, gust?: number) => {
    if (!dir && !speed) return 'Calm';
    const dirStr = dir ? `${dir.toString().padStart(3, '0')}°` : 'VRB';
    const speedStr = speed || 0;
    const gustStr = gust ? `G${gust}` : '';
    return `${dirStr} ${speedStr}${gustStr ? ` ${gustStr}` : ''}kt`;
  };

  const formatTemperature = (temp?: number) => {
    if (temp === null || temp === undefined) return 'N/A';
    return `${temp > 0 ? '+' : ''}${temp}°C`;
  };

  const formatUtcLocalTime = (iso: string | undefined) => {
    if (!iso) return 'N/A';
    const date = new Date(iso);
    const utc = date.toLocaleString(undefined, {
      timeZone: 'UTC',
      hour12: false,
    });
    const local = date.toLocaleString();
    return `${utc} UTC / ${local} local`;
  };

  const formatPressureHpa = (altimInHg?: number) => {
    if (altimInHg === null || altimInHg === undefined) return 'N/A';
    const hpa = altimInHg * 33.8639;
    return `${hpa.toFixed(1)} hPa`;
  };

  const extractRemarks = (rawText?: string) => {
    if (!rawText) return null;
    const parts = rawText.split(' RMK ');
    if (parts.length < 2) return null;
    return parts[1].trim();
  };

  return (
    <div className="weather-summary">
      <h4 className="weather-section-title">Current Weather</h4>
      {weather.current ? (
        <div className="weather-current">
          <div className="weather-row">
            <span className="weather-label">METAR:</span>
            <span className="weather-value weather-raw">{weather.current.raw_text}</span>
          </div>
          <div className="weather-conditions">
            <div className="weather-condition-item">
              <span className="weather-label">Time:</span>
              <span className="weather-value">
                {formatUtcLocalTime(weather.current.observation_time)}
              </span>
            </div>
            <div className="weather-condition-item">
              <span className="weather-label">Wind:</span>
              <span className="weather-value">
                {formatWind(
                  weather.current.wind_dir_deg,
                  weather.current.wind_speed_kt,
                  weather.current.wind_gust_kt,
                )}
              </span>
            </div>
            {weather.current.visibility_statute_mi !== null &&
              weather.current.visibility_statute_mi !== undefined && (
                <div className="weather-condition-item">
                  <span className="weather-label">Visibility:</span>
                  <span className="weather-value">
                    {weather.current.visibility_statute_mi.toFixed(1)} mi
                  </span>
                </div>
              )}
            {weather.current.decoded && weather.current.decoded.clouds.length > 0 && (
              <div className="weather-condition-item">
                <span className="weather-label">Cloud Layers:</span>
                <span className="weather-value">
                  {weather.current.decoded.clouds.join(', ')}
                </span>
              </div>
            )}
            <div className="weather-condition-item">
              <span className="weather-label">Temperature:</span>
              <span className="weather-value">{formatTemperature(weather.current.temperature_c)}</span>
            </div>
            {weather.current.dewpoint_c !== null && weather.current.dewpoint_c !== undefined && (
              <div className="weather-condition-item">
                <span className="weather-label">Dewpoint:</span>
                <span className="weather-value">{formatTemperature(weather.current.dewpoint_c)}</span>
              </div>
            )}
            {weather.current.altim_in_hg !== null && weather.current.altim_in_hg !== undefined && (
              <div className="weather-condition-item">
                <span className="weather-label">Altimeter:</span>
                <span className="weather-value">{weather.current.altim_in_hg.toFixed(2)} inHg</span>
              </div>
            )}
            {weather.current.altim_in_hg !== null && weather.current.altim_in_hg !== undefined && (
              <div className="weather-condition-item">
                <span className="weather-label">Pressure:</span>
                <span className="weather-value">
                  {formatPressureHpa(weather.current.altim_in_hg)}
                </span>
              </div>
            )}
            {weather.current.flight_category && (
              <div className="weather-condition-item">
                <span className="weather-label">Flight Category:</span>
                <span className={`weather-value weather-category ${weather.current.flight_category.toLowerCase()}`}>
                  {weather.current.flight_category}
                </span>
              </div>
            )}
            {extractRemarks(weather.current.raw_text) && (
              <div className="weather-condition-item">
                <span className="weather-label">Remarks:</span>
                <span className="weather-value">{extractRemarks(weather.current.raw_text)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="weather-unavailable">No current METAR available</div>
      )}

      {weather.forecast && (
        <>
          <h4 className="weather-section-title">TAF Forecast</h4>
          <div className="weather-forecast">
            <div className="weather-row">
              <span className="weather-label">Valid:</span>
              <span className="weather-value">
                {new Date(weather.forecast.valid_time_from).toLocaleString()} -{' '}
                {new Date(weather.forecast.valid_time_to).toLocaleString()}
              </span>
            </div>
            <div className="weather-row">
              <span className="weather-label">TAF:</span>
              <span className="weather-value weather-raw">{weather.forecast.raw_text}</span>
            </div>
            {weather.forecast.decoded && (
              <div className="weather-row">
                <span className="weather-label">Summary:</span>
                <span className="weather-value">
                  {weather.forecast.decoded.summary}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default WeatherSummary;
