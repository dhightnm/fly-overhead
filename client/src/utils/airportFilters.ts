export type AirportVisibilityMap = {
  large_airport: boolean;
  medium_airport: boolean;
  small_airport: boolean;
  heliport: boolean;
  seaplane_base: boolean;
  closed: boolean;
};

export const DEFAULT_AIRPORT_VISIBILITY: AirportVisibilityMap = {
  large_airport: true,
  medium_airport: false,
  small_airport: false,
  heliport: false,
  seaplane_base: false,
  closed: false,
};

export const AIRPORT_FILTER_OPTIONS: Array<{
  key: keyof AirportVisibilityMap;
  label: string;
}> = [
  { key: 'large_airport', label: 'Large Airports' },
  { key: 'medium_airport', label: 'Medium Airports' },
  { key: 'small_airport', label: 'Small Airports' },
  { key: 'heliport', label: 'Heliports' },
  { key: 'seaplane_base', label: 'Seaplane Bases' },
  { key: 'closed', label: 'Closed Airports' },
];

export function isAirportVisible(
  airport: { type?: string | null } | null,
  visibility: AirportVisibilityMap,
): boolean {
  if (!airport || !visibility) {
    return false;
  }

  const type = (airport.type || '').toLowerCase();

  if (type === 'closed') {
    return visibility.closed;
  }

  if (type && Object.prototype.hasOwnProperty.call(visibility, type)) {
    return visibility[type as keyof AirportVisibilityMap];
  }

  // If type is missing or unknown, align with large airport visibility
  return visibility.large_airport;
}
