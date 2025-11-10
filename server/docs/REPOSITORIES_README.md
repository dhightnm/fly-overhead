# Repository Module Structure

## Overview

The repository layer has been refactored from a monolithic 2,587-line file into a modular structure organized by domain. This improves maintainability, testability, and code organization.

## Architecture

### Base Layer
- **`DatabaseConnection.js`** - Manages database connection, PostGIS initialization
- **`SchemaRepository.js`** - All schema creation and migration methods

### Domain Repositories
- **`AircraftRepository.js`** ✅ - Aircraft states and history operations (fully implemented)
- **`RouteRepository.js`** ✅ - Route caching and flight history (fully implemented)
- **`UserRepository.js`** ✅ - User management (fully implemented)
- **`FeederRepository.js`** ✅ - Feeder operations (fully implemented)
- **`ApiKeyRepository.js`** ✅ - API key management (fully implemented)
- **`AirportRepository.js`** ✅ - Airport and navaid queries (fully implemented)

### Facade Layer
- **`index.js`** - Main `PostgresRepository` facade that composes all repositories
- **`PostgresRepository.js`** - Re-exports from `index.js` for backward compatibility

## Current Status

### ✅ Completed
- Base connection management
- Schema repository (all schema creation methods)
- Aircraft repository (all aircraft operations)
- Route repository (all route operations)
- User repository (all user operations)
- Feeder repository (all feeder operations)
- API key repository (all API key operations)
- Airport repository (all airport/navaid operations)
- Main facade with delegation pattern
- Backward compatibility maintained

## Usage

### Existing Code (No Changes Required)
All existing code continues to work without modification:

```javascript
const postgresRepository = require('../repositories/PostgresRepository');

// All existing methods work the same
await postgresRepository.upsertAircraftState(state);
await postgresRepository.cacheRoute(cacheKey, routeData);
```

### New Code (Recommended)
For new code, you can import specific repositories:

```javascript
const AircraftRepository = require('../repositories/AircraftRepository');
const { getConnection } = require('../repositories/DatabaseConnection');

const db = getConnection().getDb();
const postgis = getConnection().getPostGIS();
const aircraftRepo = new AircraftRepository(db, postgis);

await aircraftRepo.upsertAircraftState(state);
```

## Migration Complete ✅

All methods have been successfully extracted from the monolithic `PostgresRepository.old.js` into specialized repositories. The old file has been moved to `server/old-code/` for reference.

**Note**: Keep the old file as a backup for a short period to ensure everything works correctly, then remove it.

## Benefits

1. **Modularity**: Each repository handles one domain
2. **Maintainability**: Easier to find and modify code
3. **Testability**: Can test repositories independently
4. **Scalability**: Easy to add new repositories
5. **Backward Compatibility**: Existing code continues to work

## File Reference

- **Original file**: `server/old-code/PostgresRepository.old.js` (backup of original 2,587-line file)
- **Method locations**: See `REFACTORING_PLAN.md` for method-to-repository mapping

