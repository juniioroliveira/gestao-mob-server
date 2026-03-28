import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { config } from './config/env.js';
import { ensureDemoUser } from './bootstrap/demo-user.js';
import { query } from './db/query.js';

const app = express();
app.use(cors());
app.use(express.json());
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
    await query(
      "UPDATE ingest_jobs SET status = 'queued', error = 'requeued_stale' WHERE status = 'processing' AND updated_at < (NOW() - INTERVAL 10 MINUTE)"
    );
  } catch {}
}, 60 * 1000);
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
