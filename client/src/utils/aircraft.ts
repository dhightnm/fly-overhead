export const HELICOPTER_HINTS = ['heli', 'helicopter', 'rotor', 'rotorcraft', 'b06', 'bell', 'jetranger', 'mdh', 'r44', 'r66', 'aw1', 'ec1', 'uh', 'as3'];
const GLIDER_HINTS = ['glider', 'sailplane'];
const DRONE_HINTS = ['drone', 'uav', 'unmanned', 'quad'];

const PLANE_PROPERTY_KEYS = [
  'type',
  'typecode',
  'type_code',
  'aircraft_type',
  'aircraft_model',
  'aircraft_description',
  'model',
  'manufacturer',
  'make',
  'description',
];

export function inferAircraftCategory(plane?: any, route?: any): number | undefined {
  if (!plane) {
    return undefined;
  }

  if (plane.category !== undefined && plane.category !== null) {
    return plane.category;
  }

  const hints: string[] = [];
  PLANE_PROPERTY_KEYS.forEach((key) => {
    const value = plane[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      hints.push(value);
    }
  });

  if (route?.aircraft?.type) {
    hints.push(route.aircraft.type);
  }
  if (route?.aircraft?.model) {
    hints.push(route.aircraft.model);
  }

  if (hints.length === 0) {
    return undefined;
  }

  const normalized = hints.map((hint) => hint.toLowerCase());

  if (normalized.some((hint) => HELICOPTER_HINTS.some((token) => hint.includes(token)))) {
    return 7;
  }

  if (normalized.some((hint) => GLIDER_HINTS.some((token) => hint.includes(token)))) {
    return 8;
  }

  if (normalized.some((hint) => DRONE_HINTS.some((token) => hint.includes(token)))) {
    return 13;
  }

  return undefined;
}
