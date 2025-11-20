import React, { useState, useMemo } from 'react';
import type { Aircraft } from '../../types';
import './AircraftTable.css';

interface AircraftTableProps {
  aircraft: Aircraft[];
  compact?: boolean;
}

const AircraftTable: React.FC<AircraftTableProps> = ({ aircraft, compact = false }) => {
  const [sortField, setSortField] = useState<keyof Aircraft>('last_contact');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');

  const sortedAircraft = useMemo(() => {
    const filtered = aircraft.filter(ac => {
      if (!filter) return true;
      const searchTerm = filter.toLowerCase();
      return (
        ac.icao24?.toLowerCase().includes(searchTerm) ||
        ac.callsign?.toLowerCase().includes(searchTerm) ||
        ac.registration?.toLowerCase().includes(searchTerm)
      );
    });

    return [...filtered].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      
      const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [aircraft, sortField, sortDirection, filter]);

  const handleSort = (field: keyof Aircraft) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const formatAltitude = (alt: number | null | undefined) => {
    if (!alt) return '—';
    return `${Math.round(alt * 3.28084).toLocaleString()} ft`;
  };

  const formatSpeed = (vel: number | null | undefined) => {
    if (!vel) return '—';
    return `${Math.round(vel)} kts`;
  };

  const formatHeading = (track: number | null | undefined) => {
    if (!track) return '—';
    return `${track.toFixed(0)}°`;
  };

  const getDataAge = (lastContact: number | null | undefined) => {
    if (!lastContact) return '—';
    const age = Math.floor(Date.now() / 1000) - lastContact;
    if (age < 60) return `${age}s`;
    if (age < 3600) return `${Math.floor(age / 60)}m`;
    return `${Math.floor(age / 3600)}h`;
  };

  const getStatusBadge = (ac: Aircraft) => {
    if (!ac.last_contact) return <span className="status-badge unknown">Unknown</span>;
    const age = Math.floor(Date.now() / 1000) - ac.last_contact;
    if (age < 300) return <span className="status-badge active">Active</span>;
    if (age < 3600) return <span className="status-badge recent">Recent</span>;
    return <span className="status-badge stale">Stale</span>;
  };

  return (
    <div className={`aircraft-table-container ${compact ? 'compact' : ''}`}>
      <div className="table-header">
        <h2>Aircraft from Your Feeders</h2>
        <div className="table-controls">
          <input
            type="text"
            placeholder="Search by ICAO24, callsign, or registration..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="table-search"
          />
          <span className="aircraft-count">{sortedAircraft.length} aircraft</span>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="aircraft-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('callsign')} className="sortable">
                Callsign {sortField === 'callsign' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('icao24')} className="sortable">
                ICAO24 {sortField === 'icao24' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('registration')} className="sortable">
                Registration {sortField === 'registration' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th>Aircraft Type</th>
              <th onClick={() => handleSort('baro_altitude')} className="sortable">
                Altitude {sortField === 'baro_altitude' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('velocity')} className="sortable">
                Speed {sortField === 'velocity' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th onClick={() => handleSort('true_track')} className="sortable">
                Heading {sortField === 'true_track' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th>Route</th>
              <th onClick={() => handleSort('last_contact')} className="sortable">
                Last Update {sortField === 'last_contact' && (sortDirection === 'asc' ? '↑' : '↓')}
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedAircraft.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-state">
                  {filter ? 'No aircraft match your search' : 'No aircraft data available'}
                </td>
              </tr>
            ) : (
              sortedAircraft.map((ac) => (
                <tr key={ac.icao24} className="aircraft-row">
                  <td className="callsign-cell">
                    <span className="callsign-value">{ac.callsign || '—'}</span>
                  </td>
                  <td className="icao-cell">
                    <code>{ac.icao24}</code>
                  </td>
                  <td>{ac.registration || '—'}</td>
                  <td className="type-cell">
                    {ac.model || ac.aircraft_description || ac.type || '—'}
                  </td>
                  <td className="numeric">{formatAltitude(ac.baro_altitude)}</td>
                  <td className="numeric">{formatSpeed(ac.velocity)}</td>
                  <td className="numeric">{formatHeading(ac.true_track)}</td>
                  <td className="route-cell">
                    {ac.route ? (
                      <span className="route-info">
                        {ac.route.departureAirport?.icao || ac.route.departureAirport?.iata || '—'} → 
                        {ac.route.arrivalAirport?.icao || ac.route.arrivalAirport?.iata || '—'}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="update-cell">
                    <span className="update-time">{getDataAge(ac.last_contact)}</span>
                  </td>
                  <td>{getStatusBadge(ac)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AircraftTable;

