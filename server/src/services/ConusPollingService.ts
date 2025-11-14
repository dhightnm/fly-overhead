import airplanesLiveService from './AirplanesLiveService';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

/**
 * CONUS Polling Service
 * Continuously polls airplanes.live API to maintain fresh aircraft data across CONUS
 * Strategy:
 * - Divide CONUS into overlapping 250nm radius circles
 * - Poll each circle sequentially at 1 req/sec (API rate limit)
 * - Store all aircraft in database with priority 20
 * - Cycle repeats continuously
 */

interface PollingPoint {
  name: string;
  lat: number;
  lon: number;
  radiusNm: number;
}

class ConusPollingService {
  private isPolling: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentPointIndex: number = 0;

  // CONUS coverage points - strategically placed to cover major population centers
  // and flight corridors with 250nm radius circles
  private readonly pollingPoints: PollingPoint[] = [
    // West Coast
    { name: 'Seattle', lat: 47.6062, lon: -122.3321, radiusNm: 250 },
    { name: 'San Francisco', lat: 37.7749, lon: -122.4194, radiusNm: 250 },
    { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, radiusNm: 250 },
    { name: 'San Diego', lat: 32.7157, lon: -117.1611, radiusNm: 250 },

    // Southwest
    { name: 'Phoenix', lat: 33.4484, lon: -112.074, radiusNm: 250 },
    { name: 'Las Vegas', lat: 36.1699, lon: -115.1398, radiusNm: 250 },
    { name: 'Denver', lat: 39.7392, lon: -104.9903, radiusNm: 250 },
    { name: 'Albuquerque', lat: 35.0844, lon: -106.6504, radiusNm: 250 },

    // South
    { name: 'Dallas', lat: 32.7767, lon: -96.797, radiusNm: 250 },
    { name: 'Houston', lat: 29.7604, lon: -95.3698, radiusNm: 250 },
    { name: 'San Antonio', lat: 29.4241, lon: -98.4936, radiusNm: 250 },
    { name: 'New Orleans', lat: 29.9511, lon: -90.0715, radiusNm: 250 },

    // Southeast
    { name: 'Atlanta', lat: 33.749, lon: -84.388, radiusNm: 250 },
    { name: 'Miami', lat: 25.7617, lon: -80.1918, radiusNm: 250 },
    { name: 'Orlando', lat: 28.5383, lon: -81.3792, radiusNm: 250 },
    { name: 'Tampa', lat: 27.9506, lon: -82.4572, radiusNm: 250 },

    // Midwest
    { name: 'Chicago', lat: 41.8781, lon: -87.6298, radiusNm: 250 },
    { name: 'Minneapolis', lat: 44.9778, lon: -93.265, radiusNm: 250 },
    { name: 'St. Louis', lat: 38.627, lon: -90.1994, radiusNm: 250 },
    { name: 'Kansas City', lat: 39.0997, lon: -94.5786, radiusNm: 250 },

    // Northeast
    { name: 'New York', lat: 40.7128, lon: -74.006, radiusNm: 250 },
    { name: 'Boston', lat: 42.3601, lon: -71.0589, radiusNm: 250 },
    { name: 'Philadelphia', lat: 39.9526, lon: -75.1652, radiusNm: 250 },
    { name: 'Washington DC', lat: 38.9072, lon: -77.0369, radiusNm: 250 },

    // Mid-Atlantic
    { name: 'Charlotte', lat: 35.2271, lon: -80.8431, radiusNm: 250 },
    { name: 'Raleigh', lat: 35.7796, lon: -78.6382, radiusNm: 250 },

    // Mountain States
    { name: 'Salt Lake City', lat: 40.7608, lon: -111.891, radiusNm: 250 },
    { name: 'Boise', lat: 43.615, lon: -116.2023, radiusNm: 250 },

    // Northwest
    { name: 'Portland', lat: 45.5051, lon: -122.675, radiusNm: 250 },

    // Additional coverage for gaps
    { name: 'Nashville', lat: 36.1627, lon: -86.7816, radiusNm: 250 },
    { name: 'Cincinnati', lat: 39.1031, lon: -84.512, radiusNm: 250 },
    { name: 'Detroit', lat: 42.3314, lon: -83.0458, radiusNm: 250 },
    { name: 'Cleveland', lat: 41.4993, lon: -81.6944, radiusNm: 250 },
    { name: 'Pittsburgh', lat: 40.4406, lon: -79.9959, radiusNm: 250 },
    { name: 'Indianapolis', lat: 39.7684, lon: -86.1581, radiusNm: 250 },
    { name: 'Milwaukee', lat: 43.0389, lon: -87.9065, radiusNm: 250 },
  ];

  /**
   * Start continuous CONUS polling
   */
  async start(): Promise<void> {
    if (this.isPolling) {
      logger.warn('CONUS polling already running');
      return;
    }

    this.isPolling = true;
    logger.info('Starting CONUS polling service', {
      points: this.pollingPoints.length,
      cycleTime: `${this.pollingPoints.length} seconds (1 req/sec)`,
    });

    // Start polling immediately
    this.pollNext();

    // Set up interval for continuous polling (1 second = 1 req/sec rate limit)
    this.pollingInterval = setInterval(() => {
      this.pollNext();
    }, 1000); // 1 second between requests
  }

  /**
   * Stop CONUS polling
   */
  stop(): void {
    if (!this.isPolling) {
      return;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isPolling = false;
    logger.info('CONUS polling service stopped');
  }

  /**
   * Poll next point in the rotation
   */
  private async pollNext(): Promise<void> {
    if (!this.isPolling) {
      return;
    }

    const point = this.pollingPoints[this.currentPointIndex];

    try {
      const startTime = Date.now();

      // Fetch aircraft from airplanes.live
      const result = await airplanesLiveService.getAircraftNearPoint({
        lat: point.lat,
        lon: point.lon,
        radiusNm: point.radiusNm,
      });

      const duration = Date.now() - startTime;

      // Store aircraft in database
      if (result.ac && result.ac.length > 0) {
        const statePromises = result.ac
          .filter((aircraft) => aircraft.lat && aircraft.lon) // Only store aircraft with valid positions
          .map((aircraft) => {
            const preparedState = airplanesLiveService.prepareStateForDatabase(aircraft);
            // Priority 20 (airplanes.live), skipHistory=true to prevent disk fill
            return postgresRepository
              .upsertAircraftStateWithPriority(preparedState, null, new Date(), 'airplanes.live', 20, true)
              .catch((err: Error) => {
                logger.debug('Failed to store aircraft from CONUS polling', {
                  icao24: aircraft.hex,
                  error: err.message,
                });
              });
          });

        await Promise.all(statePromises);

        logger.debug('CONUS poll completed', {
          point: point.name,
          aircraftCount: result.ac.length,
          stored: statePromises.length,
          duration: `${duration}ms`,
          progress: `${this.currentPointIndex + 1}/${this.pollingPoints.length}`,
        });
      } else {
        logger.debug('CONUS poll completed (no aircraft)', {
          point: point.name,
          duration: `${duration}ms`,
          progress: `${this.currentPointIndex + 1}/${this.pollingPoints.length}`,
        });
      }
    } catch (error) {
      const err = error as Error;
      logger.error('Error during CONUS poll', {
        point: point.name,
        error: err.message,
      });
    }

    // Move to next point (wrap around)
    this.currentPointIndex = (this.currentPointIndex + 1) % this.pollingPoints.length;

    // Log cycle completion
    if (this.currentPointIndex === 0) {
      logger.info('CONUS polling cycle completed', {
        points: this.pollingPoints.length,
        cycleTime: `${this.pollingPoints.length} seconds`,
      });
    }
  }

  /**
   * Get polling status
   */
  getStatus() {
    return {
      isPolling: this.isPolling,
      currentPoint: this.isPolling ? this.pollingPoints[this.currentPointIndex].name : null,
      totalPoints: this.pollingPoints.length,
      progress: this.isPolling ? `${this.currentPointIndex + 1}/${this.pollingPoints.length}` : 'stopped',
      cycleTime: `${this.pollingPoints.length} seconds`,
    };
  }
}

// Export singleton instance
const conusPollingService = new ConusPollingService();
export default conusPollingService;
