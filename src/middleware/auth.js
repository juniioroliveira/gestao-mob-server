import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export function ensureAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = { userId: payload.userId };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

export function optionalAuth(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.auth = { userId: payload.userId };
    } catch {}
  }
  next();
}
