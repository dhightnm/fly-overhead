# TypeScript Migration Roadmap 🗺️

## Current State → Target State

```
Current (JavaScript)              Target (TypeScript)
─────────────────────            ───────────────────
server/
├── index.js          →         src/index.ts
├── config/
│   └── index.js      →         src/config/index.ts
├── repositories/
│   └── *.js         →         src/repositories/*.ts
├── services/
│   └── *.js         →         src/services/*.ts
├── routes/
│   └── *.js         →         src/routes/*.ts
└── middlewares/
    └── *.js         →         src/middlewares/*.ts
                                dist/          (compiled JS)
```

## Migration Timeline

```
Week 1: Setup & Foundation
├── Install TypeScript
├── Configure tsconfig
├── Create type definitions ✅
└── Update build scripts

Week 2: Core Infrastructure
├── Migrate config
├── Migrate utils
└── Database types

Week 3: Repositories
├── DatabaseConnection
├── SchemaRepository
├── AircraftRepository
├── RouteRepository
├── UserRepository
├── FeederRepository
├── ApiKeyRepository
└── AirportRepository

Week 4: Services
├── PostGISService
├── AircraftService
├── WebSocketService
└── [10 more services]

Week 5: Routes & Middleware
├── 3 middlewares
├── 5 route files
└── Main server

Week 6: Database & Scripts
└── Utility scripts

Week 7: Testing & Optimization
├── Update tests
├── Optimize build
└── Update Docker
```

## File Count Breakdown

| Category | Files | Status |
|----------|-------|--------|
| Type Definitions | 5 | ✅ Created |
| Repositories | 8 | ⏳ To Migrate |
| Services | 13 | ⏳ To Migrate |
| Routes | 5 | ⏳ To Migrate |
| Middlewares | 3 | ⏳ To Migrate |
| Utils | 3 | ⏳ To Migrate |
| Config | 1 | ⏳ To Migrate |
| Database | 2 | ⏳ To Migrate |
| **Total** | **40** | **5% Complete** |

## Priority Order

### 🔴 Critical (Do First)
1. Config & Utils - Foundation for everything
2. DatabaseConnection - Core infrastructure
3. AircraftRepository - Most used repository
4. AircraftService - Core business logic

### 🟡 High Priority
5. RouteRepository - Complex business logic
6. WebSocketService - Real-time features
7. Main routes - API endpoints

### 🟢 Medium Priority
8. Remaining repositories
9. Remaining services
10. Middleware

### ⚪ Low Priority
11. Utility scripts
12. Database import scripts

## Type Safety Strategy

### Phase 1: Permissive (Start Here)
```json
{
  "strict": false,
  "noImplicitAny": false,
  "strictNullChecks": false
}
```
- Allows gradual migration
- Mix JS and TS files
- Focus on structure first

### Phase 2: Moderate
```json
{
  "strict": false,
  "noImplicitAny": true,
  "strictNullChecks": false
}
```
- Require explicit types
- Still allow null/undefined flexibility

### Phase 3: Strict (Final)
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true
}
```
- Full type safety
- Catch all potential errors

## Key Decisions

### ✅ Decisions Made
- Use CommonJS modules (compatible with existing code)
- Keep `src/` directory structure
- Compile to `dist/` directory
- Start with `strict: false`
- Use path aliases for cleaner imports

### 🤔 Decisions Needed
- [ ] Enable strict mode immediately or gradually?
- [ ] Use ES modules or stick with CommonJS?
- [ ] Add runtime type validation (Zod/io-ts)?
- [ ] Migrate all at once or incrementally?

## Success Metrics

- [ ] All files migrated to TypeScript
- [ ] Zero TypeScript compilation errors
- [ ] All tests passing
- [ ] Docker builds successfully
- [ ] No runtime errors
- [ ] Improved developer experience

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking changes | Incremental migration, comprehensive testing |
| Build complexity | Clear scripts, automation |
| Learning curve | Gradual adoption, documentation |
| Time investment | Phased approach, can pause/resume |

## Getting Started

1. **Read**: `TYPESCRIPT_MIGRATION_PLAN.md` for detailed plan
2. **Review**: `TYPESCRIPT_QUICK_START.md` for commands
3. **Study**: `MIGRATION_EXAMPLE.md` for examples
4. **Install**: TypeScript dependencies
5. **Begin**: Phase 1 (Setup)

## Support Resources

- TypeScript Handbook: https://www.typescriptlang.org/docs/
- Express + TypeScript: https://expressjs.com/en/guide/routing.html
- pg-promise Types: https://github.com/vitaly-t/pg-promise

---

**Status**: Planning Complete ✅ | Ready to Begin Migration 🚀

