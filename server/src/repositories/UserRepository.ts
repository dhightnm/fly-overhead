import pgPromise from 'pg-promise';
import type { User } from '../types/database.types';

interface CreateUserData {
  email: string;
  password?: string | null;
  name: string;
  isPremium?: boolean;
  googleId?: string | null;
}

interface GoogleProfile {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * Repository for user management
 */
class UserRepository {
  private db: pgPromise.IDatabase<any>;

  constructor(db: pgPromise.IDatabase<any>) {
    this.db = db;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1';
    return this.db.oneOrNone<User>(query, [email]);
  }

  async getUserByGoogleId(googleId: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE google_id = $1';
    return this.db.oneOrNone<User>(query, [googleId]);
  }

  async getUserById(id: number): Promise<User | null> {
    const query = 'SELECT id, email, name, is_premium, premium_expires_at, is_feeder_provider, created_at FROM users WHERE id = $1';
    return this.db.oneOrNone<User>(query, [id]);
  }

  async createUser(userData: CreateUserData): Promise<User> {
    const { email, password, name, isPremium, googleId } = userData;
    const query = `
      INSERT INTO users (email, password, name, is_premium, google_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, name, is_premium, created_at
    `;
    return this.db.one<User>(query, [email, password || null, name, isPremium || false, googleId || null]);
  }

  async createOrUpdateGoogleUser(googleProfile: GoogleProfile): Promise<User> {
    const { id: googleId, email, name } = googleProfile;

    // Check if user exists by Google ID
    let user = await this.getUserByGoogleId(googleId);

    if (user) {
      // Update existing user
      const query = `
        UPDATE users
        SET email = $1, name = $2, updated_at = CURRENT_TIMESTAMP
        WHERE google_id = $3
        RETURNING id, email, name, is_premium, created_at
      `;
      return this.db.one<User>(query, [email, name, googleId]);
    }

    // Check if user exists by email (account linking)
    user = await this.getUserByEmail(email);
    if (user) {
      // Link Google account to existing user
      const query = `
        UPDATE users
        SET google_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE email = $2
        RETURNING id, email, name, is_premium, created_at
      `;
      return this.db.one<User>(query, [googleId, email]);
    }

    // Create new user
    return this.createUser({
      email,
      name,
      googleId,
      isPremium: false,
    });
  }

  async updateUserPremiumStatus(
    userId: number,
    isPremium: boolean,
    expiresAt: Date | null = null
  ): Promise<User> {
    const query = `
      UPDATE users
      SET is_premium = $1, premium_expires_at = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, email, name, is_premium, premium_expires_at, is_feeder_provider
    `;
    return this.db.one<User>(query, [isPremium, expiresAt, userId]);
  }

  /**
   * Update user's feeder provider status
   * Sets is_feeder_provider to true when user links their first feeder
   */
  async updateUserFeederProviderStatus(userId: number, isFeederProvider: boolean): Promise<User> {
    const query = `
      UPDATE users
      SET is_feeder_provider = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, email, name, is_premium, is_feeder_provider, created_at
    `;
    return this.db.one<User>(query, [isFeederProvider, userId]);
  }
}

export default UserRepository;

