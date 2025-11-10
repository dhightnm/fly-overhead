/**
 * Repository for user management
 */
class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async getUserByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    return this.db.oneOrNone(query, [email]);
  }

  async getUserByGoogleId(googleId) {
    const query = 'SELECT * FROM users WHERE google_id = $1';
    return this.db.oneOrNone(query, [googleId]);
  }

  async getUserById(id) {
    const query = 'SELECT id, email, name, is_premium, premium_expires_at, created_at FROM users WHERE id = $1';
    return this.db.oneOrNone(query, [id]);
  }

  async createUser(userData) {
    const { email, password, name, isPremium, googleId } = userData;
    const query = `
      INSERT INTO users (email, password, name, is_premium, google_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, email, name, is_premium, created_at
    `;
    return this.db.one(query, [email, password || null, name, isPremium || false, googleId || null]);
  }

  async createOrUpdateGoogleUser(googleProfile) {
    const { id: googleId, email, name, picture } = googleProfile;

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
      return this.db.one(query, [email, name, googleId]);
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
      return this.db.one(query, [googleId, email]);
    }

    // Create new user
    return this.createUser({
      email,
      name,
      googleId,
      isPremium: false,
    });
  }

  async updateUserPremiumStatus(userId, isPremium, expiresAt = null) {
    const query = `
      UPDATE users
      SET is_premium = $1, premium_expires_at = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, email, name, is_premium, premium_expires_at
    `;
    return this.db.one(query, [isPremium, expiresAt, userId]);
  }
}

module.exports = UserRepository;
