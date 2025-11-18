import {
  Router, Request, Response, NextFunction,
} from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import postgresRepository from '../repositories/PostgresRepository';
import logger from '../utils/logger';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: number;
    email: string;
  };
}

/**
 * Middleware to authenticate JWT token (required)
 */
export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication token required' });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ error: 'Invalid or expired token' });
      return;
    }
    req.user = user as { userId: number; email: string };
    return next();
  });
}

/**
 * Optional JWT authentication middleware
 * Validates JWT token if provided, but doesn't block if missing
 * Useful for endpoints that work with or without user authentication
 */
export function optionalAuthenticateToken(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  // No token provided - pass through
  if (!token) {
    req.user = undefined;
    return next();
  }

  // Try to verify token
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // Invalid token - pass through without user (don't block)
      req.user = undefined;
      return next();
    }
    req.user = user as { userId: number; email: string };
    return next();
  });
}

/**
 * Register new user
 */
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existingUser = await postgresRepository.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await postgresRepository.createUser({
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      isPremium: false,
    });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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
    const err = error as Error;
    logger.error('Registration error', { error: err.message });
    return next(error);
  }
});

/**
 * Login user
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await postgresRepository.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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
    const err = error as Error;
    logger.error('Login error', { error: err.message });
    return next(error);
  }
});

/**
 * Google OAuth login - handles authorization code exchange
 */
router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, credential } = req.body;

    const { GOOGLE_CLIENT_ID } = process.env;
    const { GOOGLE_CLIENT_SECRET } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      logger.error('Google OAuth credentials not configured');
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    let googleUser: any;

    if (credential) {
      try {
        const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        googleUser = response.data;

        if (googleUser.aud !== GOOGLE_CLIENT_ID) {
          return res.status(401).json({ error: 'Invalid Google token' });
        }
      } catch (error) {
        const err = error as Error;
        logger.error('Google token verification failed', { error: err.message });
        return res.status(401).json({ error: 'Invalid Google token' });
      }
    } else if (code) {
      try {
        let redirectUri = process.env.GOOGLE_REDIRECT_URI || 'postmessage';

        if (!redirectUri || redirectUri === 'postmessage') {
          redirectUri = 'postmessage';
        }

        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });

        const { id_token } = tokenResponse.data;

        const verifyResponse = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`);
        googleUser = verifyResponse.data;

        if (googleUser.aud !== GOOGLE_CLIENT_ID) {
          return res.status(401).json({ error: 'Invalid Google token' });
        }
      } catch (error) {
        const err = error as Error;
        logger.error('Google code exchange failed', { error: err.message });
        return res.status(401).json({ error: 'Failed to exchange authorization code' });
      }
    } else {
      return res.status(400).json({ error: 'Google credential or code is required' });
    }

    const googleProfile = {
      id: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name || googleUser.email.split('@')[0],
      picture: googleUser.picture,
    };

    const user = await postgresRepository.createOrUpdateGoogleUser(googleProfile);

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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
    const err = error as Error;
    logger.error('Google OAuth error', { error: err.message });
    return next(error);
  }
});

/**
 * Get current user (protected route)
 */
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const user = await postgresRepository.getUserById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isPremium: user.is_premium,
      isFeederProvider: user.is_feeder_provider || false,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Get user error', { error: err.message });
    return next(error);
  }
});

export default router;
