import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/query.js';
import { config } from '../config/env.js';
import { ensureAuth } from '../middleware/auth.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const router = Router();

function sign(userId) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

router.post('/auth/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'invalid_body' });
    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'email_in_use' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
    const id = result.insertId;
    const token = sign(id);
    res.status(201).json({ token, user: { id, name, email } });
  } catch (e) {
    next(e);
  }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'invalid_body' });
    const rows = await query('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const token = sign(user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    next(e);
  }
});

router.get('/auth/me', async (req, res, next) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const payload = jwt.verify(token, config.jwtSecret);
    const [row] = await query('SELECT id, name, email, avatar_url, created_at FROM users WHERE id = ?', [payload.userId]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/auth/avatar', ensureAuth, upload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const userId = req.auth.userId;
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'avatars');
    fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `u${userId}_${Date.now()}.jpg`;
    const fullPath = path.join(uploadDir, filename);
    await sharp(req.file.buffer).resize(512, 512, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(fullPath);
    const publicPath = `/uploads/avatars/${filename}`;
    await query('UPDATE users SET avatar_url = ? WHERE id = ?', [publicPath, userId]);
    res.json({ avatar_url: publicPath });
  } catch (e) {
    next(e);
  }
});

router.put('/auth/me', ensureAuth, async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { name, email } = req.body || {};
    if (!name && !email) return res.status(400).json({ error: 'invalid_body' });
    if (email) {
      const rows = await query('SELECT id FROM users WHERE email = ? AND id <> ?', [email, userId]);
      if (rows.length) return res.status(409).json({ error: 'email_in_use' });
    }
    const fields = [];
    const params = [];
    if (name) {
      fields.push('name = ?');
      params.push(name);
    }
    if (email !== undefined) {
      fields.push('email = ?');
      params.push(email);
    }
    params.push(userId);
    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    const [row] = await query('SELECT id, name, email, created_at FROM users WHERE id = ?', [userId]);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/auth/change-password', ensureAuth, async (req, res, next) => {
  try {
    const userId = req.auth.userId;
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'invalid_body' });
    const [row] = await query('SELECT password_hash FROM users WHERE id = ?', [userId]);
    const ok = await bcrypt.compare(current_password, row?.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    res.json({ ok: 1 });
  } catch (e) {
    next(e);
  }
});

export default router;
