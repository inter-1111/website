const crypto = require('crypto');
const { db, hashPassword } = require('../db');
const { sendJSON, readBody, getCurrentUser } = require('../util');

function register(router) {
  router.post('/api/auth/signup', async (req, res, ctx) => {
    const body = await readBody(req);
    const { name, email, password, phone } = body;
    if (!name || !email || !password) return sendJSON(res, 400, { error: 'Name, email and password are required.' });
    if (password.length < 6) return sendJSON(res, 400, { error: 'Password must be at least 6 characters.' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return sendJSON(res, 409, { error: 'An account with this email already exists.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const info = db.prepare('INSERT INTO users (name, email, password_hash, salt, phone, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, email.toLowerCase(), hash, salt, phone || null, 'user');

    db.prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(info.lastInsertRowid, ctx.session.token);
    const user = getCurrentUser({ user_id: info.lastInsertRowid });
    sendJSON(res, 201, { user });
  });

  router.post('/api/auth/login', async (req, res, ctx) => {
    const body = await readBody(req);
    const { email, password } = body;
    if (!email || !password) return sendJSON(res, 400, { error: 'Email and password are required.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return sendJSON(res, 401, { error: 'Invalid email or password.' });
    const hash = hashPassword(password, user.salt);
    if (hash !== user.password_hash) return sendJSON(res, 401, { error: 'Invalid email or password.' });

    db.prepare('UPDATE sessions SET user_id = ? WHERE token = ?').run(user.id, ctx.session.token);
    sendJSON(res, 200, { user: getCurrentUser({ user_id: user.id }) });
  });

  router.post('/api/auth/logout', async (req, res, ctx) => {
    db.prepare('UPDATE sessions SET user_id = NULL WHERE token = ?').run(ctx.session.token);
    sendJSON(res, 200, { ok: true });
  });

  router.get('/api/auth/me', async (req, res, ctx) => {
    sendJSON(res, 200, { user: getCurrentUser(ctx.session) });
  });

  router.put('/api/auth/me', async (req, res, ctx) => {
    const user = getCurrentUser(ctx.session);
    if (!user) return sendJSON(res, 401, { error: 'Please log in.' });
    const body = await readBody(req);
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?')
      .run(body.name ?? user.name, body.phone ?? user.phone, user.id);
    sendJSON(res, 200, { user: getCurrentUser(ctx.session) });
  });

  router.post('/api/auth/change-password', async (req, res, ctx) => {
    const user = getCurrentUser(ctx.session);
    if (!user) return sendJSON(res, 401, { error: 'Please log in.' });
    const body = await readBody(req);
    const full = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    const currentHash = hashPassword(body.currentPassword || '', full.salt);
    if (currentHash !== full.password_hash) return sendJSON(res, 400, { error: 'Current password is incorrect.' });
    if (!body.newPassword || body.newPassword.length < 6) return sendJSON(res, 400, { error: 'New password must be at least 6 characters.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(body.newPassword, salt);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, user.id);
    sendJSON(res, 200, { ok: true });
  });
}

module.exports = { register };
