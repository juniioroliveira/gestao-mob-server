import { Router } from 'express';
import health from './health.js';
import db from './db.js';
import categories from './categories.js';
import accounts from './accounts.js';
import transactions from './transactions.js';
import summary from './summary.js';
import auth from './auth.js';
import ai from './ai.js';
import recurrings from './recurrings.js';
import { ensureAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();
router.use(health);
router.use(db);
router.use(auth);
router.use(optionalAuth);
router.use(categories);
router.use(accounts);
router.use(transactions);
router.use(summary);
router.use(ai);
router.use(recurrings);

export default router;
