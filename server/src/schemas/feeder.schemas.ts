import { z } from 'zod';

export const feederAircraftBatchSchema = z.object({
  feeder_id: z.string().min(3).max(64),
  states: z.array(z.object({
    state: z.unknown(),
    feeder_id: z.string().min(3).max(64).optional(),
  })).max(1000),
});

export const feederRegisterSchema = z.object({
  feeder_id: z.string().min(3).max(64),
  api_key_hash: z.string().min(16),
  key_prefix: z.string().min(2).max(10).optional(),
  name: z.string().min(3).max(128),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const feederStatsSchema = z.object({
  feeder_id: z.string().min(3).max(64),
  messages_received: z.coerce.number().min(0),
  unique_aircraft: z.coerce.number().min(0),
});

export const feederLastSeenSchema = z.object({
  feeder_id: z.string().min(3).max(64),
});
