import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config/env.js';

let client;
function getClient() {
  if (!client && config.google.clientId) {
    client = new OAuth2Client({ clientId: config.google.clientId });
  }
  return client;
}

export async function verifyIdToken(idToken) {
  const c = getClient();
  if (!c) {
    const err = new Error('google_not_configured');
    err.status = 500;
    throw err;
  }
  const ticket = await c.verifyIdToken({ idToken, audience: config.google.clientId });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    const err = new Error('email_required');
    err.status = 400;
    throw err;
  }
  return payload;
}
