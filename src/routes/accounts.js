import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/accounts', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const rows = await query('SELECT id, user_id, name, type, currency, balance, created_at FROM accounts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/accounts', async (req, res, next) => {
  try {
    const { user_id, name, type, currency, balance } = req.body || {};
    const uid = user_id || req.auth?.userId;
    if (!uid || !name || !type) return res.status(400).json({ error: 'invalid_body' });
    const result = await query('INSERT INTO accounts (user_id, name, type, currency, balance) VALUES (?, ?, ?, ?, ?)', [uid, name, type, currency || 'BRL', balance ?? 0]);
    const [row] = await query('SELECT id, user_id, name, type, currency, balance, created_at FROM accounts WHERE id = ?', [result.insertId]);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/accounts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, type, currency, balance } = req.body || {};
    await query('UPDATE accounts SET name = COALESCE(?, name), type = COALESCE(?, type), currency = COALESCE(?, currency), balance = COALESCE(?, balance) WHERE id = ?', [name || null, type || null, currency || null, balance ?? null, id]);
    const [row] = await query('SELECT id, user_id, name, type, currency, balance, created_at FROM accounts WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete('/accounts/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM accounts WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
