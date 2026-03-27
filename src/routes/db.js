import { Router } from 'express';
import { query } from '../db/query.js';

const router = Router();

router.get('/db/ping', async (req, res, next) => {
  try {
    const rows = await query('SELECT 1 AS ok');
    res.json(rows[0] || { ok: 1 });
  } catch (e) {
    next(e);
  }
});

export default router;
