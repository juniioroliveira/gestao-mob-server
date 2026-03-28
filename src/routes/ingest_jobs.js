import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/ingest-jobs/metrics', async (_req, res, next) => {
  try {
    const [counts] = await Promise.all([
      query(
        `SELECT status, COUNT(*) AS count
         FROM ingest_jobs
         GROUP BY status`
      ),
    ]);
    const map = {};
    for (const r of counts) map[String(r.status)] = Number(r.count || 0);
    const [oldest] = await query(
      `SELECT MIN(created_at) AS oldest_created, COUNT(*) AS total
       FROM ingest_jobs
       WHERE status IN ('queued','processing')`
    );
    res.json({
      queued: map.queued || 0,
      processing: map.processing || 0,
      needs_review: map.needs_review || 0,
      failed: map.failed || 0,
      done: map.done || 0,
      oldestQueuedOrProcessingAt: oldest?.oldest_created || null,
      totalQueuedOrProcessing: Number(oldest?.total || 0),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/ingest-jobs', async (req, res, next) => {
  try {
    const userId = Number(req.auth?.userId || req.query.userId);
    if (!userId) return res.status(400).json({ error: 'userId_required' });
    const status = String(req.query.status || '').trim();
    const params = [userId];
    const where = ['user_id = ?'];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const rows = await query(
      `SELECT id, user_id, status, mime_type, filename, ai_output, error, transaction_id, created_at, updated_at
       FROM ingest_jobs
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/ingest-jobs/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [row] = await query(
      'SELECT id, user_id, status, mime_type, filename, ai_output, error, transaction_id, created_at, updated_at FROM ingest_jobs WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/ingest-jobs/:id/approve', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [job] = await query('SELECT * FROM ingest_jobs WHERE id = ?', [id]);
    if (!job) return res.status(404).json({ error: 'not_found' });
    const userId = Number(req.auth?.userId || req.query.userId || job.user_id);
    const payload = req.body || {};
    const type = payload.type || job.ai_output?.type;
    const amount = Number(payload.amount ?? job.ai_output?.amount);
    const occurred_at = payload.occurred_at || job.ai_output?.occurred_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const description = payload.description || job.ai_output?.description;
    const category_id = payload.category_id ?? job.ai_output?.category_id ?? null;
    const inscricao_federal = payload.inscricao_federal ?? job.ai_output?.inscricao_federal ?? null;
    const metadata = payload.metadata ?? job.ai_output?.metadata ?? {};
    if (!userId || !type || !Number.isFinite(amount) || !description) {
      return res.status(400).json({ error: 'invalid_body' });
    }
    const ins = await query(
      'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description, inscricao_federal, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, null, category_id, type, amount, occurred_at, description, inscricao_federal, JSON.stringify(metadata)]
    );
    await query('UPDATE ingest_jobs SET status = ?, transaction_id = ?, ai_output = ? WHERE id = ?', [
      'done',
      ins.insertId,
      JSON.stringify({ type, amount, occurred_at, description, category_id, inscricao_federal, metadata }),
      id,
    ]);
    const [row] = await query('SELECT * FROM transactions WHERE id = ?', [ins.insertId]);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

router.post('/ingest-jobs/:id/retry', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [job] = await query('SELECT * FROM ingest_jobs WHERE id = ?', [id]);
    if (!job) return res.status(404).json({ error: 'not_found' });
    await query('UPDATE ingest_jobs SET status = ?, error = NULL WHERE id = ?', ['queued', id]);
    res.json({ queued: 1 });
  } catch (e) {
    next(e);
  }
});

export default router;
