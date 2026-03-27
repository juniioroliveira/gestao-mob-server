import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { config } from './config/env.js';
import { ensureDemoUser } from './bootstrap/demo-user.js';

const app = express();
app.use(cors());
app.use(express.json());
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
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'internal_error' });
});
app.listen(config.port);
