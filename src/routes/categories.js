import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/categories', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const rows = await query('SELECT id, user_id, name, color, icon, percent, created_at FROM categories WHERE user_id = ? ORDER BY name ASC', [userId]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { user_id, name, color, icon, percent } = req.body || {};
    const uid = user_id || req.auth?.userId;
    if (!uid || !name) return res.status(400).json({ error: 'invalid_body' });
    const result = await query('INSERT INTO categories (user_id, name, color, icon, percent) VALUES (?, ?, ?, ?, ?)', [uid, name, color || null, icon || null, percent != null ? Number(percent) : null]);
    const [row] = await query('SELECT id, user_id, name, color, icon, percent, created_at FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, color, icon, percent } = req.body || {};
    const result = await query('UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon), percent = COALESCE(?, percent) WHERE id = ?', [name || null, color || null, icon || null, percent != null ? Number(percent) : null, id]);
    const [row] = await query('SELECT id, user_id, name, color, icon, percent, created_at FROM categories WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM categories WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
