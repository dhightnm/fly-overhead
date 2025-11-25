import {
  portalPaginationSchema,
  portalUserSchema,
  planeIdParamsSchema,
  createPlaneSchema,
} from '../portal.schemas';

describe('portal schemas', () => {
  describe('portalUserSchema', () => {
    it('accepts valid user payloads', () => {
      const parsed = portalUserSchema.parse({
        userId: 42,
        email: 'pilot@example.com',
      });

      expect(parsed.userId).toBe(42);
      expect(parsed.email).toBe('pilot@example.com');
    });

    it('rejects invalid identifiers', () => {
      expect(() => portalUserSchema.parse({ userId: 0 })).toThrow();
      expect(() => portalUserSchema.parse({ userId: -3 })).toThrow();
    });
  });

  describe('portalPaginationSchema', () => {
    it('applies defaults and coercions', () => {
      const parsed = portalPaginationSchema.parse({});
      expect(parsed.limit).toBe(100);
      expect(parsed.offset).toBe(0);
    });

    it('rejects invalid ranges', () => {
      expect(() => portalPaginationSchema.parse({ limit: 0 })).toThrow();
      expect(() => portalPaginationSchema.parse({ limit: 5000 })).toThrow();
      expect(() => portalPaginationSchema.parse({ offset: -1 })).toThrow();
    });
  });

  describe('planeIdParamsSchema', () => {
    it('coerces numeric strings and enforces positivity', () => {
      const parsed = planeIdParamsSchema.parse({ planeId: '123' });
      expect(parsed.planeId).toBe(123);

      expect(() => planeIdParamsSchema.parse({ planeId: '0' })).toThrow();
    });
  });

  describe('createPlaneSchema', () => {
    it('allows extra metadata due to passthrough', () => {
      const parsed = createPlaneSchema.parse({
        tailNumber: 'N12345',
        notes: 'hangar row 3',
      });

      expect(parsed.tailNumber).toBe('N12345');
      expect(parsed.notes).toBe('hangar row 3');
    });

    it('rejects invalid tail numbers', () => {
      expect(() => createPlaneSchema.parse({ tailNumber: 'N1' })).toThrow();
    });
  });
});
