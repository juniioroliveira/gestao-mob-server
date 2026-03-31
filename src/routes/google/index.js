import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { linkUserFromGooglePayload } from './user_link.js';
import { verifyIdToken } from './verify_token.js';

const router = Router();

function sign(userId) { 
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

router.get('/google/config', (req, res) => {
  res.json({ enabled: !!config.google.clientId, clientId: config.google.clientId || null });
});

router.post('/google/signin', async (req, res, next) => {
  try {
    const idToken = req.body?.idToken || req.body?.id_token;
    if (!idToken) return res.status(400).json({ error: 'id_token_required' });
    const payload = await verifyIdToken(idToken);
    const { id, name, email, avatar_url } = await linkUserFromGooglePayload(payload);
    const token = sign(id);
    res.json({ token, user: { id, name, email, avatar_url } });
  } catch (e) {
    next(e);
  }
});

export default router;
