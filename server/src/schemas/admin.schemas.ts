import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['development', 'production']).default('production'),
  scopes: z.array(z.string().min(1)).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const listApiKeysSchema = z.object({
  status: z.string().optional(),
  type: z.enum(['development', 'production']).optional(),
  limit: z.coerce.number().min(1).max(500).default(100),
  offset: z.coerce.number().min(0).default(0),
});
