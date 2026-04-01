import { Router } from 'express';
import { query } from '../db/query.js';
import { ensureAuth } from '../middleware/auth.js';

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

router.post('/family/salaries/repair-occurrence', ensureAuth, async (req, res, next) => {
  try {
    const userId = Number(req.auth.userId);
    const upNext = await query(
      `UPDATE member_salaries s
       JOIN family_members m ON m.id = s.member_id
       SET s.next_run_at = COALESCE(s.next_run_at, s.start_date)
       WHERE m.user_id = ? AND s.start_date IS NOT NULL`,
      [userId]
    );
    const fixTx = await query(
      `UPDATE transactions 
       SET occurred_at = COALESCE(salary_run_at, NOW())
       WHERE user_id = ? AND type='income' AND description LIKE 'Salário - %' AND occurred_at IS NULL`,
      [userId]
    );
    const result = await processDueSalaries();
    res.json({ nextBackfilled: upNext?.affectedRows ?? 0, txFixed: fixTx?.affectedRows ?? 0, processed: result.processed });
  } catch (e) {
    next(e);
  }
});

router.post('/family/salaries/reindex-next-run', ensureAuth, async (req, res, next) => {
  try {
    const userId = Number(req.auth.userId);
    const now = new Date();
    const force = String(req.query.force || '0') === '1';
    const forceAll = String(req.query.forceAll || req.query.force_all || '0') === '1';
    const members = await query(
      `SELECT s.id, s.member_id, s.frequency, s.day_of_month, s.start_date
       FROM member_salaries s
       JOIN family_members m ON m.id = s.member_id
       WHERE m.user_id = ? AND s.active = 1`,
      [userId]
    );
    let updated = 0;
    const details = [];
    console.log(`[salary-reindex] user=${userId} items=${members.length} force=${force} forceAll=${forceAll}`);
    for (const s of members) {
      const freq = String(s.frequency || 'monthly');
      const dom = Number(s.day_of_month || new Date(s.start_date).getDate());
      let next;
      let reason = 'calc';
      let forced = false;
      if (freq === 'monthly') {
        const daysInThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const candidateDay = Math.min(dom, daysInThisMonth);
        const candidate = new Date(now.getFullYear(), now.getMonth(), candidateDay, 12, 0, 0);
        if (forceAll) {
          next = new Date(now.getTime() - 5000);
          reason = 'forceAll';
          forced = true;
        } else if (candidate.getTime() >= now.getTime()) {
          next = candidate;
          reason = 'this_month';
          if (force && dom === now.getDate()) {
            next = new Date(now.getTime() - 5000);
            reason = 'forced_today';
            forced = true;
          }
        } else {
          next = computeNextSalaryRun({ frequency: 'monthly', day_of_month: dom }, candidate);
          reason = 'next_month';
        }
      } else if (freq === 'biweekly') {
        if (forceAll || force) {
          next = new Date(now.getTime() - 5000);
          reason = forceAll ? 'forceAll' : 'forced';
          forced = true;
        } else {
          next = new Date(now.getTime());
          next.setDate(next.getDate() + 14);
          reason = 'biweekly+14d';
        }
      } else if (freq === 'weekly') {
        if (forceAll || force) {
          next = new Date(now.getTime() - 5000);
          reason = forceAll ? 'forceAll' : 'forced';
          forced = true;
        } else {
          next = new Date(now.getTime());
          next.setDate(next.getDate() + 7);
          reason = 'weekly+7d';
        }
      } else {
        if (forceAll || force) {
          next = new Date(now.getTime() - 5000);
          reason = forceAll ? 'forceAll' : 'forced';
          forced = true;
        } else {
          next = computeNextSalaryRun({ frequency: freq, day_of_month: dom }, now);
          reason = 'fallback';
        }
      }
      const nextSql = toSqlDatetime(next);
      const prev = await query('SELECT next_run_at FROM member_salaries WHERE id = ?', [s.id]);
      const prevNext = prev?.[0]?.next_run_at || null;
      const resUpd = await query('UPDATE member_salaries SET next_run_at = ? WHERE id = ?', [nextSql, s.id]);
      updated += Number(resUpd?.affectedRows || 0);
      details.push({
        salary_id: s.id,
        frequency: freq,
        day_of_month: dom,
        prev_next_run_at: prevNext,
        new_next_run_at: nextSql,
        will_process_now: nextSql <= toSqlDatetime(now),
        reason,
        forced,
      });
    }
    const result = await processDueSalaries();
    console.log(`[salary-reindex] user=${userId} reindexed=${updated} processed=${result.processed}`);
    res.json({ nextReindexed: updated, processed: result.processed, items: details });
  } catch (e) {
    next(e);
  }
});

router.post('/family/salaries/backfill-month', ensureAuth, async (req, res, next) => {
  try {
    const userId = Number(req.auth.userId);
    const monthParam = Number(req.query.month || req.body?.month);
    const yearParam = Number(req.query.year || req.body?.year);
    if (!monthParam || monthParam < 1 || monthParam > 12) return res.status(400).json({ error: 'invalid_month' });
    const base = new Date();
    const year = Number.isFinite(yearParam) && yearParam > 1900 ? yearParam : base.getFullYear();
    const daysInMonth = new Date(year, monthParam, 0).getDate();
    const members = await query(
      `SELECT s.id, s.member_id, s.amount, s.frequency, s.day_of_month, s.start_date, m.user_id, m.name AS member_name
       FROM member_salaries s
       JOIN family_members m ON m.id = s.member_id
       WHERE m.user_id = ? AND s.active = 1`,
      [userId]
    );
    let inserted = 0;
    const items = [];
    for (const s of members) {
      const dom = Number(s.day_of_month || new Date(s.start_date).getDate());
      const day = Math.min(dom, daysInMonth);
      const occurred = toSqlDatetime(new Date(year, monthParam - 1, day, 12, 0, 0));
      const runAt = occurred; // usar a mesma data como chave de idempotência para o mês alvo
      const ins = await query(
        'INSERT IGNORE INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, salary_id, salary_run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, null, null, 'income', s.amount, occurred, `Salário - ${s.member_name}`, s.id, runAt]
      );
      const ok = Number(ins?.affectedRows || 0) === 1;
      if (ok) inserted += 1;
      items.push({ salary_id: s.id, day_of_month: dom, occurred_at: occurred, inserted: ok });
    }
    res.json({ month: monthParam, year, inserted, items });
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
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, day_of_month, next_run_at, last_run_at, created_at FROM member_salaries WHERE member_id = ? ORDER BY start_date DESC, id DESC',
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
    const { amount, currency, start_date, end_date, frequency, active, day_of_month } = req.body || {};
    if (amount == null || !start_date) return res.status(400).json({ error: 'invalid_body' });
    const freq = ['monthly', 'biweekly', 'weekly'].includes(String(frequency)) ? String(frequency) : 'monthly';
    const act = active != null ? (Number(active) ? 1 : 0) : 1;
    const start = new Date(String(start_date).replace('T', ' ').replace('Z', ''));
    const dom = Number(day_of_month || start.getDate());
    const next = computeNextSalaryRun({ frequency: freq, day_of_month: dom }, start);
    const nextSql = toSqlDatetime(next);
    const result = await query(
      'INSERT INTO member_salaries (member_id, amount, currency, start_date, end_date, frequency, active, day_of_month, next_run_at) VALUES (?, ?, COALESCE(?, "BRL"), ?, ?, ?, ?, ?, ?)',
      [memberId, Number(amount), currency || null, String(start_date), end_date || null, freq, act, dom, nextSql]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, day_of_month, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, day_of_month, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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
    const { amount, currency, start_date, end_date, frequency, active, member_id, day_of_month } = req.body || {};
    const freq =
      frequency && ['monthly', 'biweekly', 'weekly'].includes(String(frequency)) ? String(frequency) : null;
    const act = active != null ? (Number(active) ? 1 : 0) : null;
    const dom = day_of_month != null ? Number(day_of_month) : null;
    await query(
      'UPDATE member_salaries SET member_id = COALESCE(?, member_id), amount = COALESCE(?, amount), currency = COALESCE(?, currency), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), frequency = COALESCE(?, frequency), active = COALESCE(?, active), day_of_month = COALESCE(?, day_of_month), next_run_at = CASE WHEN ? IS NOT NULL THEN ? ELSE next_run_at END WHERE id = ?',
      [member_id ?? null, amount ?? null, currency || null, start_date || null, end_date || null, freq, act, dom, start_date || null, start_date || null, id]
    );
    const [row] = await query(
      'SELECT id, member_id, amount, currency, start_date, end_date, frequency, active, day_of_month, next_run_at, last_run_at, created_at FROM member_salaries WHERE id = ?',
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
  const day = Number(rule.day_of_month || base.getDate());
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
    `SELECT s.id, s.member_id, s.amount, s.currency, s.start_date, s.end_date, s.frequency, s.active, s.day_of_month, s.next_run_at, m.user_id, m.name AS member_name
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
    const now2 = new Date();
    const targetDay = Number(s.day_of_month || (isNaN(runAt.getTime()) ? now2.getDate() : runAt.getDate()));
    const lastDay = new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
    const finalDay = Math.min(targetDay, lastDay);
    const occurredDt = new Date(now2.getFullYear(), now2.getMonth(), finalDay, 12, 0, 0);
    const occurred = toSqlDatetime(occurredDt);
    const runAtSql = isNaN(runAt.getTime()) ? null : toSqlDatetime(runAt);
    const ins = await query(
      'INSERT IGNORE INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, salary_id, salary_run_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, ?)',
      [s.user_id, null, null, 'income', s.amount, occurred, `Salário - ${s.member_name}`, s.id, runAtSql]
    );
    if (Number(ins?.affectedRows || 0) === 1) {
      const baseForNext = isNaN(runAt.getTime()) ? new Date() : runAt;
      const next = computeNextSalaryRun({ frequency: s.frequency, day_of_month: targetDay }, baseForNext);
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
