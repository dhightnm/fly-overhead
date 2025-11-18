const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const postgresRepository = require('../repositories/PostgresRepository');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

/**
 * Register new user
 */
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await postgresRepository.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await postgresRepository.createUser({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      isPremium: false,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    logger.info('User registered', { email, userId: user.id });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPremium: user.is_premium,
      },
    });
  } catch (error) {
    logger.error('Registration error', { error: error.message });
    next(error);
  }
});

/**
 * Login user
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await postgresRepository.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    logger.info('User logged in', { email, userId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPremium: user.is_premium,
      },
    });
  } catch (error) {
    logger.error('Login error', { error: error.message });
    next(error);
  }
});

/**
 * Google OAuth login - handles authorization code exchange
 */
router.post('/google', async (req, res, next) => {
  try {
    const { code, credential } = req.body;

    const { GOOGLE_CLIENT_ID } = process.env;
    const { GOOGLE_CLIENT_SECRET } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      logger.error('Google OAuth credentials not configured');
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    let googleUser;

    // If credential (ID token) is provided, verify it directly
    if (credential) {
      try {
        const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        googleUser = response.data;

        // Verify the token is for our app
        if (googleUser.aud !== GOOGLE_CLIENT_ID) {
          return res.status(401).json({ error: 'Invalid Google token' });
        }
      } catch (error) {
        logger.error('Google token verification failed', { error: error.message });
        return res.status(401).json({ error: 'Invalid Google token' });
      }
    }
    // If authorization code is provided, exchange it for tokens
    else if (code) {
      try {
        // For @react-oauth/google with auth-code flow, determine the correct redirect URI
        // The library uses 'postmessage' internally, but Google Cloud Console requires actual URLs
        // Try 'postmessage' first (if registered), otherwise use the actual URL based on environment
        let redirectUri = process.env.GOOGLE_REDIRECT_URI || 'postmessage';

        // If 'postmessage' doesn't work, fall back to actual URLs based on environment
        // You can override this in your .env file if needed
        if (!redirectUri || redirectUri === 'postmessage') {
          // Try postmessage first (works if registered in Google Cloud Console)
          redirectUri = 'postmessage';
        }

        // Exchange authorization code for tokens
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });

        const { id_token } = tokenResponse.data;

        // Verify ID token
        const verifyResponse = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
        googleUser = verifyResponse.data;

        if (googleUser.aud !== GOOGLE_CLIENT_ID) {
          return res.status(401).json({ error: 'Invalid Google token' });
        }
      } catch (error) {
        logger.error('Google code exchange failed', { error: error.message });
        return res.status(401).json({ error: 'Failed to exchange authorization code' });
      }
    } else {
      return res.status(400).json({ error: 'Google credential or code is required' });
    }

    // Extract user info from Google profile
    const googleProfile = {
      id: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name || googleUser.email.split('@')[0],
      picture: googleUser.picture,
    };

    // Create or update user in database
    const user = await postgresRepository.createOrUpdateGoogleUser(googleProfile);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    logger.info('User logged in with Google', { email: user.email, userId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isPremium: user.is_premium,
      },
    });
  } catch (error) {
    logger.error('Google OAuth error', { error: error.message });
    next(error);
  }
});

/**
 * Get current user (protected route)
 */
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await postgresRepository.getUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isPremium: user.is_premium,
    });
  } catch (error) {
    logger.error('Get user error', { error: error.message });
    next(error);
  }
});

/**
 * Middleware to authenticate JWT token
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

module.exports = router;
module.exports.authenticateToken = authenticateToken;
