import { query } from '../db/query.js';
import { config } from '../config/env.js';
import bcrypt from 'bcryptjs';

export async function ensureDemoUser() {
  const email = config.demoUserEmail;
  const name = config.demoUserName;
  const password = config.demoUserPassword;
  const rows = await query('SELECT id, password_hash FROM users WHERE email = ?', [email]);
  if (rows.length) {
    const user = rows[0];
    if (!user.password_hash) {
      const hash = await bcrypt.hash(password, 10);
      await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    }
    return user.id;
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
  return result.insertId;
}
