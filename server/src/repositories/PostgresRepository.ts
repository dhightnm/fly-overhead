/**
 * Re-export the repository facade for backward compatibility
 * This allows imports like: import postgresRepository from './repositories/PostgresRepository'
 */
export { default } from './index';
export { PostgresRepository } from './index';

