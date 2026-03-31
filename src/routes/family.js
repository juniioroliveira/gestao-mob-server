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
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, next_run_at, last_run_at, created_at FROM member_salaries WHERE member_id = ? ORDER BY start_date DESC, id DESC',
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
    const start = new Date(String(start_date).replace('T', ' ').replace('Z', ''));
    const next = computeNextSalaryRun({ frequency: freq }, start);
    const nextSql = toSqlDatetime(next);
    const result = await query(
      'INSERT INTO member_salaries (member_id, amount, currency, start_date, end_date, frequency, active, next_run_at) VALUES (?, ?, COALESCE(?, "BRL"), ?, ?, ?, ?, ?)',
      [memberId, Number(amount), currency || null, String(start_date), end_date || null, freq, act, nextSql]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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
      'UPDATE member_salaries SET member_id = COALESCE(?, member_id), amount = COALESCE(?, amount), currency = COALESCE(?, currency), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), frequency = COALESCE(?, frequency), active = COALESCE(?, active), next_run_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_run_at END WHERE id = ?',
      [member_id ?? null, amount ?? null, currency || null, start_date || null, end_date || null, freq, act, start_date || null, start_date || null, id]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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

// Utilities and schedulers
function pad(n) { return String(n).padStart(2, '0'); }
function toSqlDatetime(d) {
  const yyyy = d.getFullYear(); const MM = pad(d.getMonth() + 1); const dd = pad(d.getDate());
  const hh = pad(d.getHours()); const mm = pad(d.getMinutes()); const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}
export function computeNextSalaryRun(rule, base) {
  const freq = String(rule.frequency || 'monthly');
  const from = new Date(base.getTime());
  if (freq === 'weekly') { from.setDate(from.getDate() + 7); return from; }
  if (freq === 'biweekly') { from.setDate(from.getDate() + 14); return from; }
  const day = base.getDate();
  const target = new Date(from.getFullYear(), from.getMonth(), 1);
  target.setMonth(target.getMonth() + 1);
  const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInMonth));
  target.setHours(from.getHours(), from.getMinutes(), from.getSeconds(), 0);
  return target;
}

export async function processDueSalaries() {
  const now = new Date();
  const nowSql = toSqlDatetime(now);
  const due = await query(
    `SELECT s.id, s.member_id, s.amount, s.currency, s.start_date, s.end_date, s.frequency, s.active, s.next_run_at, m.user_id, m.name AS member_name
     FROM member_salaries s
     JOIN family_members m ON m.id = s.member_id
     WHERE s.active = 1
       AND (
            (s.next_run_at IS NOT NULL AND s.next_run_at <= ?)
         OR (s.next_run_at IS NULL AND s.start_date IS NOT NULL AND s.start_date <= ?)
       )
       AND (s.end_date IS NULL OR COALESCE(s.next_run_at, s.start_date) <= s.end_date)
     ORDER BY COALESCE(s.next_run_at, s.start_date) ASC, s.id ASC`,
    [nowSql, nowSql]
  );
  for (const s of due) {
    const runBaseStr = s.next_run_at || s.start_date;
    const runAt = new Date(String(runBaseStr).replace('T', ' ').replace('Z', ''));
    const now = new Date();
    const targetDay = runAt.getDate();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const finalDay = Math.min(targetDay, lastDay);
    const occurredDt = new Date(now.getFullYear(), now.getMonth(), finalDay, 12, 0, 0);
    const occurred = toSqlDatetime(occurredDt);
    const runAtSql = toSqlDatetime(runAt);
    const ins = await query(
      'INSERT IGNORE INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, salary_id, salary_run_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?)',
      [s.user_id, null, null, 'income', s.amount, occurred, `Salário - ${s.member_name}`, s.id, runAtSql]
    );
    if (Number(ins?.affectedRows || 0) === 1) {
      const next = computeNextSalaryRun({ frequency: s.frequency }, runAt);
      const nextSql = toSqlDatetime(next);
      await query('UPDATE member_salaries SET last_run_at = ?, next_run_at = ? WHERE id = ?', [occurred, nextSql, s.id]);
    }
  }
  return { processed: due.length };
}

router.post('/family/salaries/run-due', async (req, res, next) => {
  try {
    const result = await processDueSalaries();
    res.json(result);
  } catch (e) {
    next(e);
  }
});
