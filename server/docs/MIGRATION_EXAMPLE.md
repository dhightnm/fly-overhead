# TypeScript Migration Example

This document shows how to convert a JavaScript file to TypeScript, using `UserRepository` as an example.

## Before (JavaScript)

```javascript
// server/repositories/UserRepository.js
class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async getUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    return this.db.oneOrNone(query, [email]);
  }
}

module.exports = UserRepository;
```

## After (TypeScript)

```typescript
// server/src/repositories/UserRepository.ts
import { IDatabase } from 'pg-promise';
import { User } from '../types/database.types';

export class UserRepository {
  private db: IDatabase<any>;

  constructor(db: IDatabase<any>) {
    this.db = db;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    return this.db.oneOrNone<User>(query, [email]);
  }
}

export default UserRepository;
```

## Key Changes

1. **Import statements** instead of `require()`
2. **Type annotations** for parameters and return types
3. **Interface imports** from types directory
4. **Export statements** instead of `module.exports`
5. **Access modifiers** (`private`, `public`)
6. **Generic types** for database queries

## Migration Checklist for Each File

- [ ] Convert `require()` to `import`
- [ ] Convert `module.exports` to `export`
- [ ] Add type annotations to function parameters
- [ ] Add return type annotations
- [ ] Import types from `@types/*` or local type definitions
- [ ] Add access modifiers to class properties
- [ ] Update file extension from `.js` to `.ts`
- [ ] Move file to `src/` directory
- [ ] Update imports in files that use this module

## Common Patterns

### Database Queries
```typescript
// Before
const result = await this.db.oneOrNone(query, [id]);

// After
const result = await this.db.oneOrNone<User>(query, [id]);
```

### Express Routes
```typescript
// Before
app.get('/api/users', async (req, res) => {
  const user = await repository.getUserById(req.params.id);
  res.json(user);
});

// After
app.get('/api/users/:id', async (req: Request, res: Response) => {
  const userId = parseInt(req.params.id, 10);
  const user = await repository.getUserById(userId);
  res.json(user);
});
```

### Error Handling
```typescript
// Before
catch (error) {
  logger.error('Error', { error: error.message });
}

// After
catch (error: unknown) {
  const err = error as Error;
  logger.error('Error', { error: err.message });
}
```

