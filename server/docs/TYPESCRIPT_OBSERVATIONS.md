# TypeScript Migration Observations

**Last Updated**: Migration completed, build successful ✅

This document tracks code complexity issues, redundancies, and improvement opportunities discovered during the TypeScript migration.

## Code Complexity Issues

### 1. AircraftRepository.upsertAircraftStateWithPriority
**Location**: `src/repositories/AircraftRepository.ts` (lines 239-406)
**Issue**: Massive repetitive CASE statements for every field update (130+ lines)
**Impact**: High maintenance burden, error-prone, difficult to modify
**Recommendation**: 
- Extract to a helper function that builds the CASE statement dynamically
- Consider using a field mapping configuration object
- Example refactor:
```typescript
const buildPriorityCase = (field: string) => 
  `${field} = CASE 
    WHEN EXCLUDED.source_priority < aircraft_states.source_priority 
      OR (EXCLUDED.source_priority = aircraft_states.source_priority 
          AND EXCLUDED.ingestion_timestamp > aircraft_states.ingestion_timestamp)
    THEN EXCLUDED.${field}
    ELSE aircraft_states.${field}
  END`;
```

### 2. RouteRepository.storeRouteHistory
**Location**: `src/repositories/RouteRepository.ts` (lines 201-439)
**Issue**: Very complex method with nested conditionals, multiple responsibilities
**Impact**: Hard to test, difficult to understand, high cognitive load
**Recommendation**:
- Split into smaller methods:
  - `findExistingRecentFlight()` - Check for existing flight
  - `updateExistingFlight()` - Update existing flight record
  - `createNewFlightRecord()` - Create new flight record
  - `buildFlightKey()` - Generate deterministic flight keys
- Extract update field mapping to a separate function

### 3. apiKeyAuth Middleware Duplication
**Location**: `src/middlewares/apiKeyAuth.ts`
**Issue**: `optionalApiKeyAuth` and `requireApiKeyAuth` share ~90% of the same code
**Impact**: Code duplication, maintenance burden
**Recommendation**:
- Extract common validation logic to a shared function
- Use a parameter to control whether API key is required or optional
- Example:
```typescript
async function validateApiKey(req, required: boolean) {
  // Common validation logic
  // Return { valid: boolean, keyData?: ApiKey, error?: Error }
}
```

### 4. Array-based State Format
**Location**: `src/repositories/AircraftRepository.ts`
**Issue**: Using tuple type `AircraftStateArray` with positional access (state[0], state[1])
**Impact**: Not type-safe, error-prone, hard to read
**Recommendation**:
- Create a proper `AircraftStateInput` interface/class
- Use named properties instead of array indices
- Add a mapper function to convert from OpenSky array format to typed object

### 5. RouteRepository.updateFlightHistoryById
**Location**: `src/repositories/RouteRepository.ts` (lines 499-545)
**Issue**: Manual field-by-field update building with string concatenation
**Impact**: Error-prone, verbose, hard to maintain
**Recommendation**:
- Use a field mapping object
- Generate SQL dynamically from a configuration
- Consider using a query builder library

## Redundancies

### 1. Database Query Patterns
**Issue**: Similar query patterns repeated across repositories
**Location**: Multiple repository files
**Examples**:
- `oneOrNone` pattern for single record lookups
- `manyOrNone` pattern for list queries
- Error handling patterns
**Recommendation**: 
- Create base repository class with common query methods
- Extract common query patterns to utility functions

### 2. Error Handling
**Issue**: Similar try-catch-error logging patterns throughout codebase
**Location**: Services and repositories
**Recommendation**:
- Create error handling wrapper/decorator
- Standardize error logging format
- Use custom error classes

### 3. Type Conversions
**Issue**: Repeated date/timestamp conversions
**Location**: RouteRepository, AircraftRepository
**Recommendation**:
- Create utility functions for common conversions
- Use a date/time library consistently

## Type Safety Improvements Needed

### 1. Express Request/Response Types
**Issue**: Using `any` for Express request/response objects
**Location**: Middlewares, routes
**Recommendation**:
- Use `@types/express` Request/Response types
- Create custom request interfaces extending Express Request
- Example: `interface AuthenticatedRequest extends Request { apiKey?: ApiKey }`

### 2. Database Query Return Types
**Issue**: Many queries return `any` or untyped results
**Location**: All repositories
**Recommendation**:
- Use generic types for all database queries
- Create specific return types for each query method
- Example: `db.one<AircraftState>(query, params)`

### 3. Configuration Types
**Issue**: Some config values may be undefined but not typed as such
**Location**: `src/config/index.ts`
**Recommendation**:
- Make optional fields explicitly nullable
- Add runtime validation for required config values
- Use a config validation library (e.g., joi, zod)

## Performance Considerations

### 1. N+1 Query Patterns
**Issue**: Potential N+1 queries in some service methods
**Location**: Services that fetch related data
**Recommendation**:
- Review queries for batch loading opportunities
- Use JOINs or batch queries where appropriate
- Add query performance monitoring

### 2. Large Result Sets
**Issue**: Some queries don't have limits
**Location**: Various repository methods
**Recommendation**:
- Add default limits to all list queries
- Implement pagination where needed
- Add max limit constraints

## Testing Gaps

### 1. Missing Type Tests
**Issue**: No type-level tests for complex types
**Recommendation**:
- Use TypeScript's type testing utilities
- Add runtime type validation where needed

### 2. Integration Test Coverage
**Issue**: Complex methods lack integration tests
**Recommendation**:
- Add tests for critical paths
- Test error scenarios
- Test edge cases

## Documentation Needs

### 1. Complex Method Documentation
**Issue**: Some complex methods lack detailed JSDoc comments
**Recommendation**:
- Add comprehensive JSDoc for all public methods
- Document complex algorithms
- Add examples for non-obvious usage

### 2. Type Documentation
**Issue**: Some types/interfaces lack documentation
**Recommendation**:
- Add comments explaining complex types
- Document type relationships
- Add usage examples

## Migration-Specific Notes

### 1. Import Path Consistency
**Issue**: Mix of relative and absolute imports
**Recommendation**:
- Standardize on path aliases (`@/`, `@types/`, etc.)
- Update tsconfig paths to match
- Use consistent import style

### 2. Module Exports
**Issue**: Mix of default and named exports
**Recommendation**:
- Standardize on default exports for classes
- Use named exports for utilities/types
- Document export strategy

### 3. Async Error Handling
**Issue**: Some async functions lack proper error handling
**Recommendation**:
- Add try-catch to all async functions
- Use consistent error handling patterns
- Consider async error wrapper utility

## Additional Observations from Route Migration

### 6. Route Handler Error Handling
**Location**: All route files
**Issue**: Inconsistent error handling - some use `next(error)`, some return errors directly
**Impact**: Inconsistent API responses, harder to debug
**Recommendation**:
- Standardize on Express error handling pattern (use `next(error)`)
- Create error response utility functions
- Use consistent error response format

### 7. Request Validation
**Location**: Route handlers
**Issue**: Manual validation scattered throughout routes
**Impact**: Code duplication, inconsistent validation
**Recommendation**:
- Use validation middleware (e.g., express-validator, joi)
- Create reusable validation schemas
- Centralize validation logic

### 8. Type Safety in Route Handlers
**Issue**: Request/Response bodies not typed
**Location**: All route files
**Recommendation**:
- Create request/response DTOs (Data Transfer Objects)
- Use TypeScript interfaces for request bodies
- Add runtime validation with type guards

### 9. Cache Management
**Location**: `aircraft.routes.ts`
**Issue**: Cache logic mixed with route handlers
**Impact**: Hard to test, violates single responsibility
**Recommendation**:
- Extract cache logic to a service layer
- Create cache abstraction/interface
- Make cache strategies configurable

### 10. Authentication Middleware Duplication
**Location**: `auth.routes.ts`, `apiKeyAuth.ts`
**Issue**: Similar authentication patterns in multiple places
**Impact**: Code duplication, maintenance burden
**Recommendation**:
- Create unified authentication middleware
- Support multiple auth strategies (JWT, API key)
- Use strategy pattern for different auth types

## Service Layer Observations

### 11. FlightRouteService Complexity
**Location**: `src/services/FlightRouteService.ts`
**Issue**: Very large service file (~1300 lines) with multiple responsibilities
**Impact**: Hard to test, difficult to maintain, high cognitive load
**Recommendation**:
- Split into multiple services:
  - `RouteCacheService` - Handle caching logic
  - `OpenSkyRouteService` - OpenSky-specific route fetching
  - `FlightAwareRouteService` - FlightAware-specific route fetching
  - `RouteInferenceService` - Position-based inference
- Extract route mapping/transformation logic to separate utilities

### 12. Service Singleton Pattern
**Location**: All service files
**Issue**: All services exported as singletons
**Impact**: Hard to test, can't have multiple instances, tight coupling
**Recommendation**:
- Export classes instead of instances
- Allow dependency injection in constructors
- Create factory functions for common configurations
- Use dependency injection container for production

### 13. Error Handling in Services
**Location**: Multiple service files
**Issue**: Inconsistent error handling - some throw, some return null, some log and continue
**Impact**: Unpredictable behavior, hard to debug
**Recommendation**:
- Standardize error handling strategy
- Use custom error classes (e.g., `RateLimitError`, `ApiError`)
- Create error handling utilities
- Document error handling patterns

### 14. API Rate Limiting Logic Scattered
**Location**: `OpenSkyService.ts`, `FlightAwareService.ts`, `RateLimitManager.ts`
**Issue**: Rate limiting logic mixed with API calls
**Impact**: Hard to test rate limiting independently, code duplication
**Recommendation**:
- Create rate limiting decorator/middleware
- Extract rate limit checks to shared utilities
- Use strategy pattern for different rate limit strategies

### 15. Cache Management in Services
**Location**: `FlightRouteService.ts`, `WebSocketService.ts`
**Issue**: In-memory caches (Map) mixed with business logic
**Impact**: Memory leaks potential, hard to test, no cache invalidation strategy
**Recommendation**:
- Extract cache logic to dedicated cache service
- Use Redis or similar for distributed caching
- Implement cache TTL and invalidation strategies
- Add cache metrics/monitoring

### 16. Trajectory Prediction Complexity
**Location**: `src/services/TrajectoryPredictionService.ts`
**Issue**: Complex mathematical calculations mixed with business logic
**Impact**: Hard to test, difficult to verify correctness
**Recommendation**:
- Extract mathematical functions to separate utilities
- Add unit tests for calculation functions
- Document mathematical formulas and assumptions
- Consider using a geospatial library for calculations

### 17. Background Service State Management
**Location**: `BackgroundRouteService.ts`
**Issue**: State managed with class properties (isRunning, intervalId)
**Impact**: Potential race conditions, hard to test, no state persistence
**Recommendation**:
- Use state machine pattern
- Add state persistence for graceful restarts
- Implement proper cleanup on shutdown
- Add health checks and monitoring

