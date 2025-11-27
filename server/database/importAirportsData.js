const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const pgp = require('pg-promise')();
const config = require('../config');
const logger = require('../utils/logger');
const { initializeAirportSchema } = require('./airportSchema');

/**
 * Import OurAirports CSV data into PostgreSQL
 *
 * Usage:
 *   node server/database/importAirportsData.js <path-to-csv-directory>
 *
 * Expected CSV files:
 *   - airports.csv
 *   - runways.csv
 *   - airport-frequencies.csv
 *   - navaids.csv
 */

class AirportDataImporter {
  constructor(csvDirectory) {
    this.csvDirectory = csvDirectory;
    const connectionString = config.database.postgres.url;
    this.db = pgp(connectionString);
    this.batchSize = 1000; // Insert in batches for performance
  }

  async connect() {
    try {
      await this.db.connect();
      logger.info('Database connected');
      await initializeAirportSchema(this.db);
    } catch (error) {
      logger.error('Database connection failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Read CSV file and return array of objects
   */
  async readCSV(filename) {
    return new Promise((resolve, reject) => {
      const results = [];
      const filePath = path.join(this.csvDirectory, filename);

      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });
  }

  /**
   * Import airports data
   */
  async importAirports() {
    logger.info('Importing airports...');
    const airports = await this.readCSV('airports.csv');

    const columnSet = new pgp.helpers.ColumnSet([
      'airport_id',
      'ident',
      'type',
      'name',
      { name: 'latitude_deg', cast: 'float8' },
      { name: 'longitude_deg', cast: 'float8' },
      { name: 'elevation_ft', cast: 'integer' },
      'continent',
      'iso_country',
      'iso_region',
      'municipality',
      'scheduled_service',
      'gps_code',
      'iata_code',
      'local_code',
      'home_link',
      'wikipedia_link',
      'keywords',
    ], { table: 'airports' });

    let imported = 0;

    // Process in batches
    for (let i = 0; i < airports.length; i += this.batchSize) {
      const batch = airports.slice(i, i + this.batchSize).map((row) => ({
        airport_id: row.id || null,
        ident: row.ident || null,
        type: row.type || null,
        name: row.name || null,
        latitude_deg: row.latitude_deg ? parseFloat(row.latitude_deg) : null,
        longitude_deg: row.longitude_deg ? parseFloat(row.longitude_deg) : null,
        elevation_ft: row.elevation_ft ? parseInt(row.elevation_ft, 10) : null,
        continent: row.continent || null,
        iso_country: row.iso_country || null,
        iso_region: row.iso_region || null,
        municipality: row.municipality || null,
        scheduled_service: row.scheduled_service || null,
        gps_code: row.gps_code || null,
        iata_code: row.iata_code || null,
        local_code: row.local_code || null,
        home_link: row.home_link || null,
        wikipedia_link: row.wikipedia_link || null,
        keywords: row.keywords || null,
      }));

      const query = `${pgp.helpers.insert(batch, columnSet)} ON CONFLICT (airport_id) DO NOTHING`;
      await this.db.none(query);
      imported += batch.length;

      if (i % 10000 === 0) {
        logger.info(`Imported ${imported} / ${airports.length} airports`);
      }
    }

    logger.info(`Successfully imported ${imported} airports`);
    return imported;
  }

  /**
   * Import runways data
   */
  async importRunways() {
    logger.info('Importing runways...');
    const runways = await this.readCSV('runways.csv');

    const columnSet = new pgp.helpers.ColumnSet([
      'runway_id',
      'airport_ref',
      'airport_ident',
      { name: 'length_ft', cast: 'integer' },
      { name: 'width_ft', cast: 'integer' },
      'surface',
      { name: 'lighted', cast: 'boolean' },
      { name: 'closed', cast: 'boolean' },
      'le_ident',
      { name: 'le_latitude_deg', cast: 'float8' },
      { name: 'le_longitude_deg', cast: 'float8' },
      { name: 'le_elevation_ft', cast: 'integer' },
      { name: 'le_heading_degt', cast: 'float8' },
      { name: 'le_displaced_threshold_ft', cast: 'integer' },
      'he_ident',
      { name: 'he_latitude_deg', cast: 'float8' },
      { name: 'he_longitude_deg', cast: 'float8' },
      { name: 'he_elevation_ft', cast: 'integer' },
      { name: 'he_heading_degt', cast: 'float8' },
      { name: 'he_displaced_threshold_ft', cast: 'integer' },
    ], { table: 'runways' });

    let imported = 0;

    for (let i = 0; i < runways.length; i += this.batchSize) {
      const batch = runways.slice(i, i + this.batchSize).map((row) => ({
        runway_id: row.id || null,
        airport_ref: row.airport_ref || null,
        airport_ident: row.airport_ident || null,
        length_ft: row.length_ft ? parseInt(row.length_ft, 10) : null,
        width_ft: row.width_ft ? parseInt(row.width_ft, 10) : null,
        surface: row.surface || null,
        lighted: row.lighted === '1' || row.lighted === 'true',
        closed: row.closed === '1' || row.closed === 'true',
        le_ident: row.le_ident || null,
        le_latitude_deg: row.le_latitude_deg ? parseFloat(row.le_latitude_deg) : null,
        le_longitude_deg: row.le_longitude_deg ? parseFloat(row.le_longitude_deg) : null,
        le_elevation_ft: row.le_elevation_ft ? parseInt(row.le_elevation_ft, 10) : null,
        le_heading_degt: row.le_heading_degT ? parseFloat(row.le_heading_degT) : null,
        le_displaced_threshold_ft: row.le_displaced_threshold_ft
          ? parseInt(row.le_displaced_threshold_ft, 10) : null,
        he_ident: row.he_ident || null,
        he_latitude_deg: row.he_latitude_deg ? parseFloat(row.he_latitude_deg) : null,
        he_longitude_deg: row.he_longitude_deg ? parseFloat(row.he_longitude_deg) : null,
        he_elevation_ft: row.he_elevation_ft ? parseInt(row.he_elevation_ft, 10) : null,
        he_heading_degt: row.he_heading_degT ? parseFloat(row.he_heading_degT) : null,
        he_displaced_threshold_ft: row.he_displaced_threshold_ft
          ? parseInt(row.he_displaced_threshold_ft, 10) : null,
      }));

      const query = `${pgp.helpers.insert(batch, columnSet)} ON CONFLICT (runway_id) DO NOTHING`;
      await this.db.none(query);
      imported += batch.length;

      if (i % 5000 === 0) {
        logger.info(`Imported ${imported} / ${runways.length} runways`);
      }
    }

    logger.info(`Successfully imported ${imported} runways`);
    return imported;
  }

  /**
   * Import airport frequencies data
   */
  async importFrequencies() {
    logger.info('Importing airport frequencies...');
    const frequencies = await this.readCSV('airport-frequencies.csv');

    const columnSet = new pgp.helpers.ColumnSet([
      'frequency_id',
      'airport_ref',
      'airport_ident',
      'type',
      'description',
      { name: 'frequency_mhz', cast: 'float8' },
    ], { table: 'airport_frequencies' });

    let imported = 0;

    for (let i = 0; i < frequencies.length; i += this.batchSize) {
      const batch = frequencies.slice(i, i + this.batchSize).map((row) => ({
        frequency_id: row.id || null,
        airport_ref: row.airport_ref || null,
        airport_ident: row.airport_ident || null,
        type: row.type || null,
        description: row.description || null,
        frequency_mhz: row.frequency_mhz ? parseFloat(row.frequency_mhz) : null,
      }));

      const query = `${pgp.helpers.insert(batch, columnSet)} ON CONFLICT (frequency_id) DO NOTHING`;
      await this.db.none(query);
      imported += batch.length;

      if (i % 10000 === 0) {
        logger.info(`Imported ${imported} / ${frequencies.length} frequencies`);
      }
    }

    logger.info(`Successfully imported ${imported} frequencies`);
    return imported;
  }

  /**
   * Import navaids data
   */
  async importNavaids() {
    logger.info('Importing navaids...');
    const navaids = await this.readCSV('navaids.csv');

    const columnSet = new pgp.helpers.ColumnSet([
      'navaid_id',
      'filename',
      'ident',
      'name',
      'type',
      { name: 'frequency_khz', cast: 'integer' },
      { name: 'latitude_deg', cast: 'float8' },
      { name: 'longitude_deg', cast: 'float8' },
      { name: 'elevation_ft', cast: 'integer' },
      'iso_country',
      { name: 'dme_frequency_khz', cast: 'integer' },
      'dme_channel',
      { name: 'dme_latitude_deg', cast: 'float8' },
      { name: 'dme_longitude_deg', cast: 'float8' },
      { name: 'dme_elevation_ft', cast: 'integer' },
      { name: 'slaved_variation_deg', cast: 'float8' },
      { name: 'magnetic_variation_deg', cast: 'float8' },
      'usagetype',
      'power',
      'associated_airport',
    ], { table: 'navaids' });

    let imported = 0;

    for (let i = 0; i < navaids.length; i += this.batchSize) {
      const batch = navaids.slice(i, i + this.batchSize).map((row) => ({
        navaid_id: row.id || null,
        filename: row.filename || null,
        ident: row.ident || null,
        name: row.name || null,
        type: row.type || null,
        frequency_khz: row.frequency_khz ? parseInt(row.frequency_khz, 10) : null,
        latitude_deg: row.latitude_deg ? parseFloat(row.latitude_deg) : null,
        longitude_deg: row.longitude_deg ? parseFloat(row.longitude_deg) : null,
        elevation_ft: row.elevation_ft ? parseInt(row.elevation_ft, 10) : null,
        iso_country: row.iso_country || null,
        dme_frequency_khz: row.dme_frequency_khz ? parseInt(row.dme_frequency_khz, 10) : null,
        dme_channel: row.dme_channel || null,
        dme_latitude_deg: row.dme_latitude_deg ? parseFloat(row.dme_latitude_deg) : null,
        dme_longitude_deg: row.dme_longitude_deg ? parseFloat(row.dme_longitude_deg) : null,
        dme_elevation_ft: row.dme_elevation_ft ? parseInt(row.dme_elevation_ft, 10) : null,
        slaved_variation_deg: row.slaved_variation_deg
          ? parseFloat(row.slaved_variation_deg) : null,
        magnetic_variation_deg: row.magnetic_variation_deg
          ? parseFloat(row.magnetic_variation_deg) : null,
        usagetype: row.usageType || null,
        power: row.power || null,
        associated_airport: row.associated_airport || null,
      }));

      const query = `${pgp.helpers.insert(batch, columnSet)} ON CONFLICT (navaid_id) DO NOTHING`;
      await this.db.none(query);
      imported += batch.length;

      if (i % 5000 === 0) {
        logger.info(`Imported ${imported} / ${navaids.length} navaids`);
      }
    }

    logger.info(`Successfully imported ${imported} navaids`);
    return imported;
  }

  /**
   * Aggregate runways and frequencies into airports table
   */
  async aggregateRelatedData() {
    logger.info('Aggregating runways and frequencies into airports...');

    // Aggregate runways
    const runwaysQuery = `
      UPDATE airports a
      SET runways = COALESCE(
        (SELECT jsonb_agg(runway_data)
         FROM (
           SELECT 
             r.runway_id,
             r.length_ft,
             r.width_ft,
             r.surface,
             r.lighted,
             r.closed,
             jsonb_build_object(
               'ident', r.le_ident,
               'latitude_deg', r.le_latitude_deg,
               'longitude_deg', r.le_longitude_deg,
               'elevation_ft', r.le_elevation_ft,
               'heading_degT', r.le_heading_degT,
               'displaced_threshold_ft', r.le_displaced_threshold_ft
             ) as low_end,
             jsonb_build_object(
               'ident', r.he_ident,
               'latitude_deg', r.he_latitude_deg,
               'longitude_deg', r.he_longitude_deg,
               'elevation_ft', r.he_elevation_ft,
               'heading_degT', r.he_heading_degT,
               'displaced_threshold_ft', r.he_displaced_threshold_ft
             ) as high_end
           FROM runways r
           WHERE r.airport_ident = a.ident
           ORDER BY r.length_ft DESC NULLS LAST
         ) runway_data),
        '[]'::jsonb
      );
    `;

    await this.db.none(runwaysQuery);
    logger.info('Runways aggregated into airports');

    // Aggregate frequencies
    const frequenciesQuery = `
      UPDATE airports a
      SET frequencies = COALESCE(
        (SELECT jsonb_agg(freq_data)
         FROM (
           SELECT 
             f.frequency_id,
             f.type,
             f.description,
             f.frequency_mhz
           FROM airport_frequencies f
           WHERE f.airport_ident = a.ident
           ORDER BY f.type, f.frequency_mhz
         ) freq_data),
        '[]'::jsonb
      );
    `;

    await this.db.none(frequenciesQuery);
    logger.info('Frequencies aggregated into airports');
  }

  /**
   * Import all data
   */
  async importAll() {
    const startTime = Date.now();

    try {
      await this.connect();

      const stats = {
        airports: await this.importAirports(),
        runways: 0,
        frequencies: 0,
        navaids: 0,
      };

      // Try to import optional files, skip if they don't exist
      try {
        stats.runways = await this.importRunways();
      } catch (error) {
        if (error.message.includes('File not found')) {
          logger.info('Runways file not found, skipping...');
        } else {
          throw error;
        }
      }

      try {
        stats.frequencies = await this.importFrequencies();
      } catch (error) {
        if (error.message.includes('File not found')) {
          logger.info('Frequencies file not found, skipping...');
        } else {
          throw error;
        }
      }

      try {
        stats.navaids = await this.importNavaids();
      } catch (error) {
        if (error.message.includes('File not found')) {
          logger.info('Navaids file not found, skipping...');
        } else {
          throw error;
        }
      }

      // Aggregate runways and frequencies into airports (only if they were imported)
      if (stats.runways > 0 || stats.frequencies > 0) {
        await this.aggregateRelatedData();
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('Import completed successfully', {
        stats,
        duration: `${duration}s`,
      });

      return stats;
    } catch (error) {
      logger.error('Import failed', { error: error.message, stack: error.stack });
      throw error;
    } finally {
      pgp.end();
    }
  }
}

// CLI execution
if (require.main === module) {
  const csvDirectory = process.argv[2];

  if (!csvDirectory) {
    console.error('Usage: node importAirportsData.js <path-to-csv-directory>');
    console.error('Example: node importAirportsData.js ./data/ourairports');
    process.exit(1);
  }

  const importer = new AirportDataImporter(csvDirectory);
  importer.importAll()
    .then((stats) => {
      console.log('\n✅ Import completed successfully!');
      console.log(JSON.stringify(stats, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import failed:', error.message);
      process.exit(1);
    });
}

module.exports = AirportDataImporter;
