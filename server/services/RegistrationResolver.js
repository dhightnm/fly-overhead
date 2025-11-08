const LRU = require('lru-cache');
const postgresRepository = require('../repositories/PostgresRepository');
const { normalizeRegistration } = require('../utils/registration');
const { mapAircraftType } = require('../utils/aircraftCategoryMapper');
const logger = require('../utils/logger');

class RegistrationResolver {
  constructor() {
    this.registrationCache = new LRU({
      max: 5000,
      ttl: 1000 * 60 * 60, // 1 hour
    });
    this.icaoCache = new LRU({
      max: 5000,
      ttl: 1000 * 60 * 30, // 30 minutes
    });
  }

  formatCatalogRow(row) {
    if (!row) return null;
    const typecode = row.our_typecode || null;
    const info = mapAircraftType(typecode, row.our_model);
    const model = row.our_model || info.model || null;
    const category = row.our_category ?? info.category ?? null;
    return {
      registration: row.registration || null,
      icao24: row.icao24 || null,
      ourTypecode: typecode,
      ourModel: model,
      ourCategory: category,
      source: row.source || null,
      confidence: row.confidence ?? null,
      updatedAt: row.updated_at || null,
    };
  }

  cacheRegistration(registration, value) {
    if (!registration) return;
    this.registrationCache.set(registration, value || null);
  }

  cacheIcao(icao24, value) {
    if (!icao24) return;
    this.icaoCache.set(icao24, value || null);
  }

  async resolveByRegistration(registration) {
    const normalized = normalizeRegistration(registration);
    if (!normalized) return null;

    if (this.registrationCache.has(normalized)) {
      return this.registrationCache.get(normalized);
    }

    const row = await postgresRepository.getRegistrationCatalogEntry(normalized);
    const formatted = this.formatCatalogRow(row);
    this.cacheRegistration(normalized, formatted);
    if (formatted?.icao24) {
      this.cacheIcao(formatted.icao24, formatted);
    }
    return formatted;
  }

  async resolveByIcao24(icao24) {
    if (!icao24) return null;
    const icaoKey = String(icao24).toLowerCase();
    if (this.icaoCache.has(icaoKey)) {
      return this.icaoCache.get(icaoKey);
    }

    const row = await postgresRepository.getRegistrationCatalogByIcao24(icaoKey);
    const formatted = this.formatCatalogRow(row);
    this.cacheIcao(icaoKey, formatted);
    if (formatted?.registration) {
      this.cacheRegistration(formatted.registration, formatted);
    }
    return formatted;
  }

  /**
   * Resolve registration classification using registration and/or icao24.
   * @param {Object} params
   * @param {string} [params.registration]
   * @param {string} [params.icao24]
   */
  async resolve(params = {}) {
    const { registration, icao24 } = params;
    const fromRegistration = await this.resolveByRegistration(registration);
    if (fromRegistration) return fromRegistration;
    return this.resolveByIcao24(icao24);
  }

  /**
   * Backfill registration catalog using latest data from flight_routes_history.
   * @param {number} limit Number of distinct registrations to process
   */
  async backfillFromHistory(limit = 500) {
    const rows = await postgresRepository.getDistinctRegistrationsFromHistory(limit);
    if (!rows || rows.length === 0) {
      logger.info('RegistrationResolver.backfillFromHistory: no rows found for backfill');
      return { processed: 0 };
    }

    let processed = 0;
    for (const row of rows) {
      const normalizedReg = normalizeRegistration(row.registration);
      const icao24Norm = row.icao24 ? String(row.icao24).toLowerCase() : null;
      if (!normalizedReg || !icao24Norm) {
        continue;
      }

      const aircraftType = row.aircraft_type ? String(row.aircraft_type).toUpperCase().trim() : null;
      const aircraftModel = row.aircraft_model || null;
      const info = mapAircraftType(aircraftType, aircraftModel);

      try {
        await postgresRepository.upsertRegistrationCatalog(normalizedReg, icao24Norm, {
          ourTypecode: aircraftType || null,
          ourModel: info.model || aircraftModel || null,
          ourCategory: info.category ?? null,
          source: row.source || 'history',
          confidence: aircraftType ? 80 : 60,
        });

        await postgresRepository.upsertRegistrationHistory(normalizedReg, icao24Norm, row.source || 'history');

        this.cacheRegistration(normalizedReg, {
          registration: normalizedReg,
          icao24: icao24Norm,
          ourTypecode: aircraftType || null,
          ourModel: info.model || aircraftModel || null,
          ourCategory: info.category ?? null,
          source: row.source || 'history',
          confidence: aircraftType ? 80 : 60,
          updatedAt: new Date().toISOString(),
        });
        processed += 1;
      } catch (error) {
        logger.warn('RegistrationResolver.backfillFromHistory failed for entry', {
          registration: normalizedReg,
          icao24: icao24Norm,
          error: error.message,
        });
      }
    }

    logger.info('RegistrationResolver.backfillFromHistory complete', {
      processed,
      requested: rows.length,
    });

    return { processed, requested: rows.length };
  }
}

module.exports = new RegistrationResolver();

