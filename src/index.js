import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import path from 'path';
import { config } from './config/env.js';
import { ensureDemoUser } from './bootstrap/demo-user.js';
import { query } from './db/query.js';
import { processIngestJobById } from './routes/ai.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.use((req, res, next) => {
  const start = Date.now();
  const method = req.method;
  const url = req.originalUrl;
  const ip =
    (req.headers['x-forwarded-for'] || '')
      .toString()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0] ||
    req.socket?.remoteAddress ||
    '';
  const ua = req.headers['user-agent'] || '';
  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const length = res.getHeader('content-length');
    const uid = req.auth?.userId;
    const len = length ? ` ${length}b` : '';
    const user = uid ? ` uid=${uid}` : '';
    console.log(
      `[${new Date().toISOString()}] ${method} ${url} ${status} ${ms}ms${len} ip=${ip} ua="${ua}"${user}`
    );
  });
  next();
});
// Fallback: attach default demo user when no auth
let defaultUserId = null;
ensureDemoUser().then((id) => {
  defaultUserId = id;
}).catch(() => {});
app.use((req, _res, next) => {
  if (!req.auth?.userId && defaultUserId) {
    req.auth = { userId: defaultUserId };
  }
  next();
});
app.use('/api', routes);
app.get('/', (req, res) => {
  res.json({ name: 'gestao-mob-api' });
});
setInterval(async () => {
  try {
    await query("UPDATE ingest_jobs SET status = 'queued', error = 'requeued_stale' WHERE status = 'processing' AND updated_at < (NOW() - INTERVAL ? MINUTE)", [config.ingest?.staleMinutes ?? 10]);
  } catch {}
}, 60 * 1000);
setTimeout(async () => {
  try {
    // Ensure backoff columns exist (best-effort, ignore errors if they already exist or server lacks privileges)
    try { await query("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0"); } catch {}
    try { await query("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS max_attempts INT NULL"); } catch {}
    try { await query("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS next_attempt_at DATETIME NULL"); } catch {}
    try { await query("ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS last_attempt_at DATETIME NULL"); } catch {}
    // Set defaults where missing
    try { await query("UPDATE ingest_jobs SET max_attempts = ? WHERE max_attempts IS NULL", [config.ingest?.maxAttempts ?? 5]); } catch {}
    await query("UPDATE ingest_jobs SET status = 'queued', error = COALESCE(error,'requeued_on_boot') WHERE status = 'processing'");
  } catch {}
  let pumping = false;
  async function claimNext() {
    try {
      const rows = await query("SELECT id FROM ingest_jobs WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) ORDER BY created_at ASC, id ASC LIMIT 1");
      const id = Number(rows?.[0]?.id || 0);
      if (!id) return null;
      const res = await query("UPDATE ingest_jobs SET status = 'processing', attempts = attempts + 1, last_attempt_at = NOW(), updated_at = NOW() WHERE id = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()) AND (max_attempts IS NULL OR attempts < max_attempts)", [id]);
      if (res?.affectedRows === 1) return id;
      return null;
    } catch {
      return null;
    }
  }
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const id = await claimNext();
        if (!id) break;
        await processIngestJobById(id);
      }
    } finally {
      pumping = false;
    }
  }
  await pump();
  setInterval(pump, config.ingest?.pumpIntervalMs ?? 3000);
}, 0);
app.use((err, req, res, next) => {
  const payload = {
    error: 'internal_error',
    message: err?.message,
    code: err?.code,
    errno: err?.errno,
    sqlState: err?.sqlState,
  };
  console.error(
    `[${new Date().toISOString()}] Error in ${req.method} ${req.originalUrl}`,
    { ...payload, stack: err?.stack }
  );
  res.status(500).json(payload);
});
app.listen(config.port);
