import { Router } from 'express';
import { config } from '../config/env.js';

const router = Router();

router.get('/health', (req, res) => {
  const env = {
    PORT: process.env.PORT || null,
    DB_HOST: process.env.DB_HOST || null,
    DB_NAME: process.env.DB_NAME || null,
    DB_USER: process.env.DB_USER || null,
    JWT_SECRET_SET: !!process.env.JWT_SECRET,
    effective: {
      port: config.port,
      dbHost: config.db.host,
      dbName: config.db.database,
      dbUser: config.db.user,
    },
  };
  res.json({ ok: true, env });
});

export default router;
