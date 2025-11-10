# TypeScript Migration Quick Start Guide

## Step 1: Install Dependencies

```bash
cd server
npm install --save-dev typescript @types/node @types/express @types/cors @types/bcryptjs @types/jsonwebtoken @types/passport @types/passport-google-oauth20 @types/pg ts-node ts-node-dev nodemon
npm install --save-dev @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

## Step 2: Verify TypeScript Configuration

The following files have been created:
- ✅ `tsconfig.json` - Main TypeScript configuration
- ✅ `tsconfig.build.json` - Build-specific configuration
- ✅ `src/types/` - Type definition directory

## Step 3: Update package.json Scripts

Add these scripts to `server/package.json`:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "build:watch": "tsc -p tsconfig.build.json --watch",
    "start": "node dist/index.js",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "type-check": "tsc --noEmit",
    "lint": "eslint . --ext .ts,.js",
    "lint:fix": "eslint --fix . --ext .ts,.js"
  }
}
```

## Step 4: Create src/ Directory Structure

```bash
mkdir -p server/src/{config,repositories,services,routes,middlewares,utils,database,types}
```

## Step 5: Start Migration

Begin with Phase 1 (Setup) from `TYPESCRIPT_MIGRATION_PLAN.md`:

1. Migrate `config/index.js` → `src/config/index.ts`
2. Migrate `utils/logger.js` → `src/utils/logger.ts`
3. Create type definitions in `src/types/`

## Step 6: Test Build

```bash
npm run build
npm run type-check
```

## Step 7: Update Docker (When Ready)

Update `Dockerfile` to compile TypeScript:

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

## Migration Order (Recommended)

1. **Types** - Create all type definitions first
2. **Config** - Migrate configuration
3. **Utils** - Migrate utility functions
4. **Repositories** - Migrate data access layer
5. **Services** - Migrate business logic
6. **Routes** - Migrate API endpoints
7. **Main** - Migrate entry point

## Tips

- Use `allowJs: true` during migration to mix JS and TS
- Start with `strict: false`, enable gradually
- Test each migrated module before moving to the next
- Keep old `.js` files until migration is complete
- Use `// @ts-ignore` sparingly and document why

