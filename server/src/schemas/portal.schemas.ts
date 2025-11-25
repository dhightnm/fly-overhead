import { z } from 'zod';

export const portalUserSchema = z.object({
  userId: z.number().int().positive(),
  email: z.string().email().optional(),
});

export const portalPaginationSchema = z.object({
  limit: z.coerce.number()
    .int()
    .min(1)
    .max(1000)
    .default(100),
  offset: z.coerce.number()
    .int()
    .min(0)
    .default(0),
});

export const planeIdParamsSchema = z.object({
  planeId: z.coerce.number().int().positive(),
});

export const createPlaneSchema = z.object({
  tailNumber: z.string().min(3).max(12),
}).passthrough();
