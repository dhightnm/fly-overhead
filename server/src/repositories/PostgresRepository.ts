/**
 * Re-export the repository facade for backward compatibility
 * This allows imports like: import postgresRepository from './repositories/PostgresRepository'
 */
import postgresRepository from './index';

export default postgresRepository;
export { PostgresRepository } from './index';
