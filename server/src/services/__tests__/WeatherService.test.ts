import weatherService from '../WeatherService';
import postgresRepository from '../../repositories';
import aviationWeatherService from '../AviationWeatherService';

jest.mock('../../repositories', () => ({
  getLatestMETAR: jest.fn(),
  getLatestTAF: jest.fn(),
  saveMETAR: jest.fn(),
  saveTAF: jest.fn(),
  updateWeatherCache: jest.fn(),
}));

jest.mock('../AviationWeatherService', () => ({
  __esModule: true,
  default: {
    getMETAR: jest.fn(),
    getTAF: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('WeatherService', () => {
  const airportIdent = 'KTEST';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getWeatherSummary', () => {
    it('returns cached METAR and TAF when useCache is true and data is fresh', async () => {
      const now = new Date();

      (postgresRepository.getLatestMETAR as jest.Mock).mockResolvedValue({
        id: 1,
        airport_ident: airportIdent,
        observation_time: new Date(now.getTime() - 5 * 60 * 1000),
        raw_text: 'TEST METAR',
      });

      (postgresRepository.getLatestTAF as jest.Mock).mockResolvedValue({
        id: 2,
        airport_ident: airportIdent,
        issue_time: now,
        valid_time_from: now,
        valid_time_to: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        raw_text: 'TEST TAF',
      });

      const { metar, taf } = await weatherService.getWeatherSummary(airportIdent, true);

      expect(metar).not.toBeNull();
      expect(taf).not.toBeNull();
      expect(aviationWeatherService.getMETAR).not.toHaveBeenCalled();
      expect(aviationWeatherService.getTAF).not.toHaveBeenCalled();
    });

    it('falls back to AviationWeatherService when cache is missing', async () => {
      (postgresRepository.getLatestMETAR as jest.Mock).mockResolvedValue(null);
      (postgresRepository.getLatestTAF as jest.Mock).mockResolvedValue(null);

      (aviationWeatherService.getMETAR as jest.Mock).mockResolvedValue({
        rawOb: 'RAW METAR',
        obsTime: new Date().toISOString(),
      });
      (aviationWeatherService.getTAF as jest.Mock).mockResolvedValue({
        rawTAF: 'RAW TAF',
        issueTime: new Date().toISOString(),
        validTimeFrom: new Date().toISOString(),
        validTimeTo: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });

      (postgresRepository.saveMETAR as jest.Mock).mockResolvedValue({
        id: 10,
        airport_ident: airportIdent,
        observation_time: new Date(),
        raw_text: 'RAW METAR',
      });

      (postgresRepository.saveTAF as jest.Mock).mockResolvedValue({
        id: 20,
        airport_ident: airportIdent,
        issue_time: new Date(),
        valid_time_from: new Date(),
        valid_time_to: new Date(Date.now() + 60 * 60 * 1000),
        raw_text: 'RAW TAF',
      });

      const { metar, taf } = await weatherService.getWeatherSummary(airportIdent, true);

      expect(aviationWeatherService.getMETAR).toHaveBeenCalledWith(airportIdent);
      expect(aviationWeatherService.getTAF).toHaveBeenCalledWith(airportIdent);
      expect(metar).not.toBeNull();
      expect(taf).not.toBeNull();
    });

    it('handles absence of data gracefully', async () => {
      (postgresRepository.getLatestMETAR as jest.Mock).mockResolvedValue(null);
      (postgresRepository.getLatestTAF as jest.Mock).mockResolvedValue(null);
      (aviationWeatherService.getMETAR as jest.Mock).mockResolvedValue(null);
      (aviationWeatherService.getTAF as jest.Mock).mockResolvedValue(null);

      const { metar, taf } = await weatherService.getWeatherSummary(airportIdent, true);

      expect(metar).toBeNull();
      expect(taf).toBeNull();
    });
  });
});
