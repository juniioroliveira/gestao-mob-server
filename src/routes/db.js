import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/db/ping', async (req, res, next) => {
  try {
    const rows = await query('SELECT 1 AS ok');
    res.json(rows[0] || { ok: 1 });
  } catch (e) {
    res.status(500).json({
      error: 'db_error',
      message: e?.message,
      code: e?.code,
      errno: e?.errno,
      sqlState: e?.sqlState,
    });
  }
});

export default router;
