import { Router } from 'express';
import { query } from '../db/query.js';
 
const router = Router();
 
async function ensureRecurringsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS recurrings (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        account_id BIGINT NULL,
        category_id BIGINT NULL,
        type ENUM('income','expense','transfer') NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        description VARCHAR(255) NULL,
        frequency ENUM('daily','weekly','monthly') NOT NULL,
        \`interval\` INT NOT NULL DEFAULT 1,
        day_of_month TINYINT NULL,
        day_of_week TINYINT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        next_run_at DATETIME NOT NULL,
        last_run_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recurring_user (user_id),
        INDEX idx_recurring_next (next_run_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch {}
}
 
function pad(n) {
  return String(n).padStart(2, '0');
}
 
function toSqlDate(d) {
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  return `${yyyy}-${MM}-${dd}`;
}
 
function toSqlDatetime(d) {
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}
 
function computeNextRun(rule, baseDate) {
  const freq = String(rule.frequency);
  const interval = Number(rule.interval || 1);
  const from = new Date(baseDate.getTime());
  if (freq === 'daily') {
    from.setDate(from.getDate() + interval);
    return from;
  }
  if (freq === 'weekly') {
    const dow = rule.day_of_week != null ? Number(rule.day_of_week) : from.getDay();
    const curDow = from.getDay();
    let delta = (dow - curDow + 7) % 7;
    if (delta === 0) delta = 7 * interval;
    else if (interval > 1) delta += 7 * (interval - 1);
    from.setDate(from.getDate() + delta);
    return from;
  }
  if (freq === 'monthly') {
    const dom = rule.day_of_month != null ? Number(rule.day_of_month) : from.getDate();
    const target = new Date(from.getFullYear(), from.getMonth(), 1);
    target.setMonth(target.getMonth() + interval);
    const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const day = Math.min(dom, daysInMonth);
    target.setDate(day);
    target.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), 0);
    return target;
  }
  return new Date(from.getTime() + 24 * 3600 * 1000);
}
 
router.get('/recurrings', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    await ensureRecurringsTable();
    const rows = await query(
      `SELECT id, user_id, account_id, category_id, type, amount, description, frequency, \`interval\`, day_of_month, day_of_week, start_date, end_date, next_run_at, last_run_at, created_at
       FROM recurrings
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});
 
router.post('/recurrings', async (req, res, next) => {
  try {
    const body = req.body || {};
    const uid = Number(body.user_id || req.auth?.userId || req.query.userId);
    if (!uid) return res.status(400).json({ error: 'userId_required' });
    const type = body.type;
    const amount = body.amount;
    const description = body.description || null;
    const frequency = String(body.frequency || 'monthly');
    const interval = Number(body.interval || 1);
    const day_of_month = body.day_of_month != null ? Number(body.day_of_month) : null;
    const day_of_week = body.day_of_week != null ? Number(body.day_of_week) : null;
    const start_date = body.start_date ? String(body.start_date) : toSqlDate(new Date());
    const end_date = body.end_date ? String(body.end_date) : null;
    const account_id = body.account_id != null ? Number(body.account_id) : null;
    const category_id = body.category_id != null ? Number(body.category_id) : null;
    if (!type || amount == null) return res.status(400).json({ error: 'invalid_body' });
    const start = new Date(start_date.replace('T', ' ').replace('Z', ''));
    const initialNext = computeNextRun({ frequency, interval, day_of_month, day_of_week }, start);
    const next_run_at = toSqlDatetime(initialNext);
    await ensureRecurringsTable();
    const result = await query(
      `INSERT INTO recurrings (user_id, account_id, category_id, type, amount, description, frequency, \`interval\`, day_of_month, day_of_week, start_date, end_date, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uid, account_id, category_id, type, amount, description, frequency, interval, day_of_month, day_of_week, start_date, end_date, next_run_at]
    );
    const [row] = await query(
      `SELECT id, user_id, account_id, category_id, type, amount, description, frequency, \`interval\`, day_of_month, day_of_week, start_date, end_date, next_run_at, last_run_at, created_at
       FROM recurrings WHERE id = ?`,
      [result.insertId]
    );
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});
 
router.put('/recurrings/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    await query(
      `UPDATE recurrings SET
         account_id = COALESCE(?, account_id),
         category_id = COALESCE(?, category_id),
         type = COALESCE(?, type),
         amount = COALESCE(?, amount),
         description = COALESCE(?, description),
         frequency = COALESCE(?, frequency),
         \`interval\` = COALESCE(?, \`interval\`),
         day_of_month = COALESCE(?, day_of_month),
         day_of_week = COALESCE(?, day_of_week),
         start_date = COALESCE(?, start_date),
         end_date = COALESCE(?, end_date)
       WHERE id = ?`,
      [
        body.account_id ?? null,
        body.category_id ?? null,
        body.type || null,
        body.amount ?? null,
        body.description || null,
        body.frequency || null,
        body.interval ?? null,
        body.day_of_month ?? null,
        body.day_of_week ?? null,
        body.start_date || null,
        body.end_date || null,
        id,
      ]
    );
    const [row] = await query(
      `SELECT id, user_id, account_id, category_id, type, amount, description, frequency, \`interval\`, day_of_month, day_of_week, start_date, end_date, next_run_at, last_run_at, created_at
       FROM recurrings WHERE id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});
 
router.delete('/recurrings/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await query('DELETE FROM recurrings WHERE id = ?', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
 
router.post('/recurrings/run-due', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const now = new Date();
    const nowSql = toSqlDatetime(now);
    const rules = await query(
      `SELECT id, user_id, account_id, category_id, type, amount, description, frequency, \`interval\`, day_of_month, day_of_week, start_date, end_date, next_run_at, last_run_at
       FROM recurrings
       WHERE user_id = ? AND next_run_at <= ? AND (end_date IS NULL OR next_run_at <= end_date)
       ORDER BY next_run_at ASC`,
      [userId, nowSql]
    );
    const created = [];
    for (const r of rules) {
      const runAt = new Date(String(r.next_run_at).replace('T', ' ').replace('Z', ''));
      const txOccurred = toSqlDatetime(runAt);
      const ins = await query(
        'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, r.account_id ?? null, r.category_id ?? null, r.type, r.amount, txOccurred, r.description || null]
      );
      const [tx] = await query(
        'SELECT id, user_id, account_id, category_id, type, amount, occurred_at, description, created_at FROM transactions WHERE id = ?',
        [ins.insertId]
      );
      created.push(tx);
      const nextDate = computeNextRun(r, runAt);
      const nextSql = toSqlDatetime(nextDate);
      await query('UPDATE recurrings SET last_run_at = ?, next_run_at = ? WHERE id = ?', [txOccurred, nextSql, r.id]);
    }
    res.json({ createdCount: created.length, transactions: created });
  } catch (e) {
    next(e);
  }
});
 
export default router;
