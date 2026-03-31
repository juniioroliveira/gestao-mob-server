import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/categories', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const type = (req.query.type || '').toString().toLowerCase();
    if (type && !['income', 'expense', 'transfer'].includes(type)) {
      return res.status(400).json({ error: 'invalid_type' });
    }
    const sql =
      'SELECT id, user_id, name, color, icon, percent, subcategories, kind, created_at FROM categories WHERE user_id = ?' +
      (type ? ' AND kind = ?' : '') +
      ' ORDER BY name ASC';
    const params = type ? [userId, type] : [userId];
    const rows = await query(sql, params);
    res.json(rows);
  } catch (e) {
    next(e); 
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { user_id, name, color, icon, percent, subcategories, kind } = req.body || {};
    const uid = user_id || req.auth?.userId;
    if (!uid || !name) return res.status(400).json({ error: 'invalid_body' });
    const k = (kind || 'expense').toString().toLowerCase();
    if (!['income', 'expense', 'transfer'].includes(k)) return res.status(400).json({ error: 'invalid_kind' });
    const result = await query('INSERT INTO categories (user_id, name, color, icon, percent, subcategories, kind) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      uid,
      name,
      color || null,
      icon || null,
      percent != null ? Number(percent) : null,
      subcategories ? JSON.stringify(subcategories) : null,
      k,
    ]);
    const [row] = await query('SELECT id, user_id, name, color, icon, percent, subcategories, kind, created_at FROM categories WHERE id = ?', [result.insertId]);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/categories/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, color, icon, percent, subcategories, kind } = req.body || {};
    const k = kind ? (kind.toString().toLowerCase()) : null;
    if (k && !['income', 'expense', 'transfer'].includes(k)) return res.status(400).json({ error: 'invalid_kind' });
    const result = await query('UPDATE categories SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon), percent = COALESCE(?, percent), subcategories = COALESCE(?, subcategories), kind = COALESCE(?, kind) WHERE id = ?', [
      name || null,
      color || null,
      icon || null,
      percent != null ? Number(percent) : null,
      subcategories ? JSON.stringify(subcategories) : null,
      k,
      id,
    ]);
    const [row] = await query('SELECT id, user_id, name, color, icon, percent, subcategories, kind, created_at FROM categories WHERE id = ?', [id]);
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
