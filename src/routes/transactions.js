import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/transactions', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const conditions = ['user_id = ?'];
    const params = [userId];
    if (req.query.type) {
      conditions.push('type = ?');
      params.push(String(req.query.type));
    }
    if (req.query.categoryId) {
      conditions.push('category_id = ?');
      params.push(Number(req.query.categoryId));
    }
    if (req.query.accountId) {
      conditions.push('account_id = ?');
      params.push(Number(req.query.accountId));
    }
    if (req.query.from) {
      conditions.push('occurred_at >= ?');
      params.push(String(req.query.from));
    }
    if (req.query.to) {
      conditions.push('occurred_at <= ?');
      params.push(String(req.query.to));
    }
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const sql = `SELECT id, user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata, created_at
                 FROM transactions
                 WHERE ${conditions.join(' AND ')}
                 ORDER BY occurred_at DESC, id DESC
                 LIMIT ? OFFSET ?`;
    const rows = await query(sql, [...params, limit, offset]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/transactions', async (req, res, next) => {
  try {
    const { user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata } = req.body || {};
    const uid = user_id || req.auth?.userId;
    if (!uid || !type || amount == null || !occurred_at) return res.status(400).json({ error: 'invalid_body' });
    const result = await query(
      'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uid, account_id || null, category_id || null, type, amount, occurred_at, description || null, inscricao_federal || null, metadata ? JSON.stringify(metadata) : null]
    );
    const [row] = await query('SELECT id, user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata, created_at FROM transactions WHERE id = ?', [result.insertId]);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.put('/transactions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata } = req.body || {};
    await query(
      'UPDATE transactions SET account_id = COALESCE(?, account_id), category_id = COALESCE(?, category_id), type = COALESCE(?, type), amount = COALESCE(?, amount), occurred_at = COALESCE(?, occurred_at), description = COALESCE(?, description), inscricao_federal = COALESCE(?, inscricao_federal), metadata = COALESCE(?, metadata) WHERE id = ?',
      [account_id ?? null, category_id ?? null, type || null, amount ?? null, occurred_at || null, description || null, inscricao_federal || null, metadata ? JSON.stringify(metadata) : null, id]
    );
    const [row] = await query('SELECT id, user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata, created_at FROM transactions WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.delete('/transactions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM transactions WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
