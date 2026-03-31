import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/summary/net-worth', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const rows = await query(
      `SELECT 
         COALESCE(SUM(CASE WHEN type='asset' THEN balance END),0) AS assets,
         COALESCE(SUM(CASE WHEN type='liability' THEN balance END),0) AS liabilities
       FROM accounts
       WHERE user_id = ?`,
      [userId]
    );
    const { assets = 0, liabilities = 0 } = rows[0] || {};
    res.json({ assets, liabilities, netWorth: Number(assets) - Number(liabilities) });
  } catch (e) {
    next(e);
  }
});

function monthRange({ month, year }) {
  if (month && year) {
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 0);
    return {
      from: start.toISOString().slice(0, 19).replace('T', ' '),
      to: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' '),
    };
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    from: start.toISOString().slice(0, 19).replace('T', ' '),
    to: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' '),
  };
}

router.get('/summary/category-spend', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const { from, to } = monthRange({ month: req.query.month, year: req.query.year });
    const rows = await query(
      `SELECT c.id, c.name, COALESCE(SUM(ABS(t.amount)),0) AS amount
       FROM categories c
       LEFT JOIN transactions t
         ON t.category_id = c.id
        AND t.user_id = ?
        AND t.type = 'expense'
        AND t.occurred_at BETWEEN ? AND ?
       WHERE c.user_id = ?
       GROUP BY c.id, c.name
       ORDER BY amount DESC`,
      [userId, from, to, userId]
    );
    const total = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
    res.json({ total, from, to, categories: rows });
  } catch (e) {
    next(e);
  }
});

router.get('/summary/monthly', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const from = req.query.from;
    const to = req.query.to;
    const range =
      from && to
        ? { from, to }
        : monthRange({ month: req.query.month, year: req.query.year });
    const rows = await query(
      `SELECT 
         COALESCE(SUM(CASE WHEN type='income' THEN ABS(amount) END),0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN ABS(amount) END),0) AS expense
       FROM transactions
       WHERE user_id = ? AND occurred_at BETWEEN ? AND ?`,
      [userId, range.from, range.to]
    );
    const { income = 0, expense = 0 } = rows[0] || {};
    res.json({ from: range.from, to: range.to, income, expense, delta: Number(income) - Number(expense) });
  } catch (e) {
    next(e);
  }
});

export default router;
