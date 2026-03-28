import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

// Family Members
router.get('/family/members', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const rows = await query(
      'SELECT id, user_id, name, relation, email, birthdate, created_at FROM family_members WHERE user_id = ? ORDER BY name ASC',
      [userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/family/members', async (req, res, next) => {
  try {
    const { user_id, name, relation, email, birthdate } = req.body || {};
    const uid = user_id || req.auth?.userId;
    if (!uid || !name) return res.status(400).json({ error: 'invalid_body' });
    const rel = ['owner', 'spouse', 'child', 'other'].includes(String(relation)) ? String(relation) : 'other';
    const result = await query(
      'INSERT INTO family_members (user_id, name, relation, email, birthdate) VALUES (?, ?, ?, ?, ?)',
      [uid, name, rel, email || null, birthdate || null]
    );
    const [row] = await query(
      'SELECT id, user_id, name, relation, email, birthdate, created_at FROM family_members WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/family/members/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, relation, email, birthdate } = req.body || {};
    const relVal =
      relation && ['owner', 'spouse', 'child', 'other'].includes(String(relation)) ? String(relation) : null;
    await query(
      'UPDATE family_members SET name = COALESCE(?, name), relation = COALESCE(?, relation), email = COALESCE(?, email), birthdate = COALESCE(?, birthdate) WHERE id = ?',
      [name || null, relVal, email || null, birthdate || null, id]
    );
    const [row] = await query(
      'SELECT id, user_id, name, relation, email, birthdate, created_at FROM family_members WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete('/family/members/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM family_members WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Member Salaries
router.get('/family/members/:id/salaries', async (req, res, next) => {
  try {
    const memberId = Number(req.params.id);
    if (!memberId) return res.status(400).json({ error: 'memberId_required' });
    const rows = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, created_at FROM member_salaries WHERE member_id = ? ORDER BY start_date DESC, id DESC',
      [memberId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/family/members/:id/salaries', async (req, res, next) => {
  try {
    const memberId = Number(req.params.id);
    if (!memberId) return res.status(400).json({ error: 'memberId_required' });
    const { amount, currency, start_date, end_date, frequency, active } = req.body || {};
    if (amount == null || !start_date) return res.status(400).json({ error: 'invalid_body' });
    const freq = ['monthly', 'biweekly', 'weekly'].includes(String(frequency)) ? String(frequency) : 'monthly';
    const act = active != null ? (Number(active) ? 1 : 0) : 1;
    const result = await query(
      'INSERT INTO member_salaries (member_id, amount, currency, start_date, end_date, frequency, active) VALUES (?, ?, COALESCE(?, "BRL"), ?, ?, ?, ?)',
      [memberId, Number(amount), currency || null, String(start_date), end_date || null, freq, act]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, created_at FROM member_salaries WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.get('/family/salaries/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, created_at FROM member_salaries WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/family/salaries/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { amount, currency, start_date, end_date, frequency, active, member_id } = req.body || {};
    const freq =
      frequency && ['monthly', 'biweekly', 'weekly'].includes(String(frequency)) ? String(frequency) : null;
    const act = active != null ? (Number(active) ? 1 : 0) : null;
    await query(
      'UPDATE member_salaries SET member_id = COALESCE(?, member_id), amount = COALESCE(?, amount), currency = COALESCE(?, currency), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), frequency = COALESCE(?, frequency), active = COALESCE(?, active) WHERE id = ?',
      [member_id ?? null, amount ?? null, currency || null, start_date || null, end_date || null, freq, act, id]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, created_at FROM member_salaries WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete('/family/salaries/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM member_salaries WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
