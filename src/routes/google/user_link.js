import { query } from '../../db/query.js';

export async function linkUserFromGooglePayload(payload) {
  const email = payload?.email;
  const name = payload?.name || email?.split('@')?.[0] || 'User';
  const picture = payload?.picture || null;
  const rows = await query('SELECT id, name, email, avatar_url FROM users WHERE email = ?', [email]);
  let id;
  if (rows.length) {
    id = rows[0].id;
    if (picture && rows[0].avatar_url !== picture) {
      await query('UPDATE users SET avatar_url = ? WHERE id = ?', [picture, id]);
    }
  } else {
    const result = await query('INSERT INTO users (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)', [
      name,
      email,
      '',
      picture,
    ]);
    id = result.insertId;
  }
  return { id, name, email, avatar_url: picture };
}
