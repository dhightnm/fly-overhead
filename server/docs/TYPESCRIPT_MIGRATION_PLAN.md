# TypeScript Migration Plan for Backend

## Overview

This document outlines the plan to migrate the Fly Overhead backend from JavaScript to TypeScript, aligning with modern coding practices and improving type safety, developer experience, and code maintainability.

## Current State

- **Language**: JavaScript (ES6+)
- **Structure**: Modular with repositories, services, routes, middlewares
- **Client**: Already using TypeScript ✅
- **Server**: Pure JavaScript
- **Build**: Direct Node.js execution
- **Docker**: Runs `node server/index.js`

## Goals

1. ✅ Type safety across the entire backend
2. ✅ Better IDE support and autocomplete
3. ✅ Catch errors at compile time
4. ✅ Improved code documentation through types
5. ✅ Easier refactoring and maintenance
6. ✅ Consistent with frontend (already TypeScript)

## Migration Strategy

### Phase 1: Setup & Foundation (Week 1)

#### 1.1 Install TypeScript Dependencies
```bash
cd server
npm install --save-dev typescript @types/node @types/express @types/cors @types/bcryptjs @types/jsonwebtoken @types/passport @types/passport-google-oauth20 @types/pg ts-node nodemon
npm install --save-dev @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

#### 1.2 Create TypeScript Configuration
- `server/tsconfig.json` - Main TypeScript config
- `server/tsconfig.build.json` - Build-specific config
- Update `.dockerignore` to exclude `.ts` files (only ship compiled `.js`)

#### 1.3 Update package.json Scripts
```json
{
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "type-check": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.js",
    "lint:fix": "eslint --fix . --ext .ts,.js"
  }
}
```

#### 1.4 Create Type Definitions Directory
- `server/src/types/` - Shared type definitions
- `server/src/types/database.types.ts` - Database models
- `server/src/types/api.types.ts` - API request/response types
- `server/src/types/config.types.ts` - Configuration types
- `server/src/types/services.types.ts` - Service interfaces

### Phase 2: Core Infrastructure (Week 2)

#### 2.1 Migrate Configuration
- `config/index.ts` - Type-safe configuration
- Define interfaces for all config sections
- Use environment variable validation

#### 2.2 Migrate Utilities
- `utils/logger.ts` - Logger with proper types
- `utils/aircraftCategoryMapper.ts` - Type-safe mapper
- `utils/apiKeyGenerator.ts` - Typed generator

#### 2.3 Create Database Types
- Define interfaces for all database models:
  - `AircraftState`, `AircraftHistory`
  - `FlightRoute`, `FlightRouteHistory`
  - `User`, `Feeder`, `ApiKey`
  - `Airport`, `Navaid`

#### 2.4 Migrate Database Connection
- `repositories/DatabaseConnection.ts` - Typed connection manager
- Add proper return types for all database operations

### Phase 3: Repositories (Week 3)

#### 3.1 Migrate Base Repository
- `repositories/DatabaseConnection.ts` ✅ (already created, convert to TS)
- `repositories/SchemaRepository.ts` → `.ts`

#### 3.2 Migrate Domain Repositories (in order)
1. `repositories/AircraftRepository.ts` - Most critical
2. `repositories/RouteRepository.ts` - Complex business logic
3. `repositories/UserRepository.ts` - Authentication critical
4. `repositories/FeederRepository.ts`
5. `repositories/ApiKeyRepository.ts`
6. `repositories/AirportRepository.ts`

#### 3.3 Update Repository Facade
- `repositories/index.ts` - Update to TypeScript
- Maintain backward compatibility

### Phase 4: Services (Week 4)

#### 4.1 Core Services (Priority Order)
1. `services/PostGISService.ts` - Database service
2. `services/Logger.ts` - Utility service
3. `services/AircraftService.ts` - Core business logic
4. `services/WebSocketService.ts` - Real-time communication
5. `services/HistoryService.ts` - Data retrieval

#### 4.2 External API Services
6. `services/OpenSkyService.ts` - External API
7. `services/FlightAwareService.ts` - External API
8. `services/SatelliteService.ts` - External API

#### 4.3 Background Services
9. `services/BackgroundRouteService.ts` - Background jobs
10. `services/FlightRouteService.ts` - Route fetching
11. `services/FlightPlanRouteService.ts` - Flight planning
12. `services/TrajectoryPredictionService.ts` - Predictions
13. `services/RateLimitManager.ts` - Rate limiting

### Phase 5: Middleware & Routes (Week 5)

#### 5.1 Migrate Middleware
- `middlewares/errorHandler.ts` - Error handling
- `middlewares/requestLogger.ts` - Request logging
- `middlewares/apiKeyAuth.ts` - Authentication

#### 5.2 Migrate Routes
- `routes/health.routes.ts` - Health checks
- `routes/auth.routes.ts` - Authentication
- `routes/aircraft.routes.ts` - Aircraft endpoints
- `routes/admin.routes.ts` - Admin endpoints
- `routes/feeder.routes.ts` - Feeder endpoints

#### 5.3 Update Main Server
- `index.ts` - Main application entry point
- Type all Express middleware
- Type all route handlers

### Phase 6: Database & Scripts (Week 6)

#### 6.1 Migrate Database Utilities
- `database/airportSchema.ts` - Schema definitions
- `database/importAirportsData.ts` - Data import scripts

#### 6.2 Migrate Utility Scripts
- `scripts/` - Convert utility scripts to TypeScript
- Keep as separate tools (not part of main build)

### Phase 7: Testing & Optimization (Week 7)

#### 7.1 Update Tests
- Convert Jest tests to TypeScript
- Add type checking to test files
- Update test utilities

#### 7.2 Build Optimization
- Optimize TypeScript compilation
- Set up incremental builds
- Configure source maps for debugging

#### 7.3 Docker Updates
- Update Dockerfile to compile TypeScript
- Multi-stage build for production
- Development Docker setup with hot reload

## File Structure After Migration

```
server/
├── src/                          # TypeScript source files
│   ├── index.ts                  # Main entry point
│   ├── config/
│   │   └── index.ts
│   ├── types/                    # Type definitions
│   │   ├── database.types.ts
│   │   ├── api.types.ts
│   │   ├── config.types.ts
│   │   └── services.types.ts
│   ├── repositories/
│   │   ├── DatabaseConnection.ts
│   │   ├── SchemaRepository.ts
│   │   ├── AircraftRepository.ts
│   │   ├── RouteRepository.ts
│   │   ├── UserRepository.ts
│   │   ├── FeederRepository.ts
│   │   ├── ApiKeyRepository.ts
│   │   ├── AirportRepository.ts
│   │   └── index.ts
│   ├── services/
│   │   └── [all services].ts
│   ├── routes/
│   │   └── [all routes].ts
│   ├── middlewares/
│   │   └── [all middlewares].ts
│   ├── utils/
│   │   └── [all utils].ts
│   └── database/
│       └── [database files].ts
├── dist/                         # Compiled JavaScript (gitignored)
├── scripts/                      # Utility scripts (TypeScript)
├── migrations/                   # SQL migrations (unchanged)
├── tsconfig.json                 # TypeScript config
├── tsconfig.build.json           # Build config
└── package.json
```

## Type Definitions Needed

### Database Models
```typescript
interface AircraftState {
  id: number;
  icao24: string;
  callsign: string | null;
  origin_country: string | null;
  time_position: number | null;
  last_contact: number | null;
  longitude: number | null;
  latitude: number | null;
  // ... all fields
}

interface FlightRoute {
  callsign: string;
  icao24: string;
  departureAirport?: Airport;
  arrivalAirport?: Airport;
  source: string;
  // ... all fields
}

interface User {
  id: number;
  email: string;
  google_id?: string;
  name: string;
  is_premium: boolean;
  // ... all fields
}
```

### API Types
```typescript
interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

interface AircraftBoundsRequest {
  latmin: number;
  lonmin: number;
  latmax: number;
  lonmax: number;
}
```

### Service Interfaces
```typescript
interface IAircraftService {
  fetchAndUpdateAllAircraft(): Promise<void>;
  getAircraftInBounds(...): Promise<AircraftState[]>;
}

interface IRouteRepository {
  cacheRoute(cacheKey: string, routeData: RouteData): Promise<void>;
  getCachedRoute(cacheKey: string): Promise<RouteData | null>;
}
```

## Migration Best Practices

### 1. Incremental Migration
- Migrate one module at a time
- Keep `.js` and `.ts` files side-by-side during transition
- Use `allowJs: true` in tsconfig during migration

### 2. Type Safety Gradual Adoption
- Start with `strict: false`
- Gradually enable strict mode features:
  - `strictNullChecks`
  - `strictFunctionTypes`
  - `noImplicitAny`

### 3. Backward Compatibility
- Maintain same module.exports structure
- Keep same function signatures
- Don't break existing API contracts

### 4. Testing Strategy
- Test each migrated module thoroughly
- Run existing tests after each migration
- Add type tests for critical paths

## Docker Configuration Updates

### Development Dockerfile
```dockerfile
FROM node:18

WORKDIR /app/server

# Install dependencies
COPY server/package*.json ./
RUN npm install

# Copy source files
COPY server/ ./

# Use ts-node-dev for hot reload
CMD ["npm", "run", "dev"]
```

### Production Dockerfile
```dockerfile
# Build stage
FROM node:18 AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

# Production stage
FROM node:18
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --production
COPY --from=build /app/server/dist ./server/dist
CMD ["node", "server/dist/index.js"]
```

## Benefits After Migration

1. **Type Safety**: Catch errors at compile time
2. **Better IDE Support**: Autocomplete, refactoring, navigation
3. **Self-Documenting Code**: Types serve as documentation
4. **Easier Refactoring**: TypeScript compiler catches breaking changes
5. **Consistency**: Matches frontend TypeScript codebase
6. **Modern Tooling**: Access to latest TypeScript features
7. **Better Testing**: Type-safe test utilities

## Risks & Mitigation

### Risk 1: Breaking Changes
- **Mitigation**: Incremental migration, comprehensive testing

### Risk 2: Build Complexity
- **Mitigation**: Clear build scripts, Docker automation

### Risk 3: Learning Curve
- **Mitigation**: Gradual adoption, team training

### Risk 4: Migration Time
- **Mitigation**: Phased approach, can pause/resume

## Timeline Estimate

- **Phase 1**: 1 week (Setup)
- **Phase 2**: 1 week (Infrastructure)
- **Phase 3**: 1 week (Repositories)
- **Phase 4**: 1 week (Services)
- **Phase 5**: 1 week (Routes/Middleware)
- **Phase 6**: 1 week (Database/Scripts)
- **Phase 7**: 1 week (Testing/Optimization)

**Total**: ~7 weeks for complete migration

## Quick Start Commands

```bash
# Install TypeScript
cd server
npm install --save-dev typescript @types/node @types/express

# Initialize TypeScript
npx tsc --init

# Start development with TypeScript
npm run dev

# Build for production
npm run build
```

## Next Steps

1. Review and approve this plan
2. Set up TypeScript configuration (Phase 1)
3. Begin incremental migration
4. Update CI/CD pipelines
5. Update documentation

