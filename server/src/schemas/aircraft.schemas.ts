import { z } from 'zod';
import config from '../config';

const MAX_RADIUS = config.external.airplanesLive?.maxRadiusNm || 250;

export const flightsQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(MAX_RADIUS).default(100),
});

export const aircraftIdentifierSchema = z.object({
  identifier: z.string().min(3).max(10),
});
