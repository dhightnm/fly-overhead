import type { UserAircraftProfile } from '../../types';
import { PlaneProfileValidationError, UserAircraftProfileService } from '../UserAircraftProfileService';

describe('UserAircraftProfileService', () => {
  const createMockDb = () => ({
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
  });

  let mockDb: ReturnType<typeof createMockDb>;
  let service: UserAircraftProfileService;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new UserAircraftProfileService(mockDb as any);
  });

  describe('listProfilesForUser', () => {
    it('returns profiles for a valid user', async () => {
      const profiles = [
        { id: 1, tail_number: 'N12345' },
      ] as unknown as UserAircraftProfile[];
      mockDb.any.mockResolvedValue(profiles);

      const result = await service.listProfilesForUser(42);

      expect(mockDb.any).toHaveBeenCalledWith(expect.stringContaining('FROM user_aircraft_profiles'), [42]);
      expect(result).toEqual(profiles);
    });

    it('throws when user id is invalid', async () => {
      await expect(service.listProfilesForUser(0)).rejects.toThrow(PlaneProfileValidationError);
    });
  });

  describe('createProfile', () => {
    const baseInput = {
      tailNumber: 'n12345',
      manufacturer: 'Cessna',
      model: '172S',
      category: 'airplane',
      homeAirportCode: 'ksna',
      airspeedUnit: 'mph',
      lengthUnit: 'meters',
      weightUnit: 'kilograms',
      fuelUnit: 'liters',
      bestGlideRatio: '9.5',
      avionics: ['G1000', { manufacturer: 'Garmin', model: 'GTN750' }],
    };

    it('normalizes payload and inserts record', async () => {
      const fakeProfile = { id: 10 } as UserAircraftProfile;
      mockDb.one.mockResolvedValue(fakeProfile);

      const result = await service.createProfile(99, baseInput);

      expect(result).toBe(fakeProfile);
      expect(mockDb.one).toHaveBeenCalledTimes(1);

      const call = mockDb.one.mock.calls[0];
      expect(call[0]).toContain('INSERT INTO user_aircraft_profiles');
      const params = call[1] as unknown[];
      expect(params[0]).toBe(99);
      expect(params[1]).toBe('N12345'); // tail number uppercased
      expect(params[13]).toBe('mph'); // airspeed unit index 13 (0-based)
      expect(params[14]).toBe('meters');
      expect(params[15]).toBe('kilograms');
      expect(params[16]).toBe('liters');
      expect(JSON.parse(params[21] as string)).toHaveLength(2);
    });

    it('throws when tail number missing', async () => {
      await expect(service.createProfile(99, { ...baseInput, tailNumber: '' })).rejects.toThrow(PlaneProfileValidationError);
    });

    it('throws when user id invalid', async () => {
      await expect(service.createProfile(0, baseInput)).rejects.toThrow(PlaneProfileValidationError);
    });
  });

  describe('updateProfile', () => {
    const baseInput = {
      tailNumber: 'N12345',
      manufacturer: 'Cessna',
    };

    it('updates a plane when found', async () => {
      const fakeProfile = { id: 5 } as UserAircraftProfile;
      mockDb.oneOrNone.mockResolvedValue(fakeProfile);

      const result = await service.updateProfile(10, 5, baseInput);

      expect(result).toBe(fakeProfile);
      expect(mockDb.oneOrNone).toHaveBeenCalledWith(expect.stringContaining('UPDATE user_aircraft_profiles'), expect.arrayContaining([5, 10]));
    });

    it('throws when plane not found', async () => {
      mockDb.oneOrNone.mockResolvedValue(null);
      await expect(service.updateProfile(10, 999, baseInput)).rejects.toThrow('Plane not found');
    });

    it('validates identifiers', async () => {
      await expect(service.updateProfile(0, 1, baseInput)).rejects.toThrow(PlaneProfileValidationError);
      await expect(service.updateProfile(1, 0, baseInput)).rejects.toThrow(PlaneProfileValidationError);
    });
  });
});
