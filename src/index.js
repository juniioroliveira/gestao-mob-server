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
// Ensure recurrings table exists on boot
query(`
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
`).catch(() => {});
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
