/**
 * PostgresRepository - Main repository facade
 *
 * This file maintains backward compatibility by re-exporting the new modular structure.
 * All existing imports will continue to work without changes.
 *
 * The new modular structure is organized as:
 * - DatabaseConnection.js: Connection management
 * - SchemaRepository.js: Schema creation and migrations
 * - Domain repositories: AircraftRepository, RouteRepository, etc.
 * - index.js: Main facade that composes all repositories
 */

// Re-export from the new modular structure
module.exports = require('./index');
