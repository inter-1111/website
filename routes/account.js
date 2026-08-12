const { db } = require('../db');
const { sendJSON, readBody, getCurrentUser } = require('../util');
const { withImage } = require('./catalog');

function requireAuth(ctx, res) {
  const user = getCurrentUser(ctx.session);
  if (!user) { sendJSON(res, 401, { error: 'Please log in to continue.' }); return null; }
  return user;
}

function register(router) {
  // Wishlist
  router.get('/api/wishlist', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const rows = db.prepare(`SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id WHERE w.user_id = ? ORDER BY w.created_at DESC`).all(user.id);
    sendJSON(res, 200, { items: rows.map(withImage) });
  });

  router.post('/api/wishlist', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const body = await readBody(req);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(body.productId);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    try {
      db.prepare('INSERT INTO wishlist (user_id, product_id) VALUES (?, ?)').run(user.id, body.productId);
    } catch (e) { /* already exists */ }
    sendJSON(res, 200, { ok: true });
  });

  router.del('/api/wishlist/:productId', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(user.id, ctx.params.productId);
    sendJSON(res, 200, { ok: true });
  });

  // Addresses
  router.get('/api/addresses', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const rows = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(user.id);
    sendJSON(res, 200, { addresses: rows });
  });

  router.post('/api/addresses', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const b = await readBody(req);
    if (!b.line1 || !b.city) return sendJSON(res, 400, { error: 'Address line and city are required.' });
    if (b.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(user.id);
    const countExisting = db.prepare('SELECT COUNT(*) c FROM addresses WHERE user_id = ?').get(user.id).c;
    const info = db.prepare(`INSERT INTO addresses (user_id, label, full_name, line1, city, state, zip, country, phone, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, b.label || 'Home', b.full_name || user.name, b.line1, b.city, b.state || '', b.zip || '', b.country || '', b.phone || '', (b.is_default || countExisting === 0) ? 1 : 0);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  });

  router.put('/api/addresses/:id', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(ctx.params.id, user.id);
    if (!addr) return sendJSON(res, 404, { error: 'Address not found.' });
    const b = await readBody(req);
    if (b.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(user.id);
    db.prepare(`UPDATE addresses SET label=?, full_name=?, line1=?, city=?, state=?, zip=?, country=?, phone=?, is_default=? WHERE id=?`)
      .run(b.label ?? addr.label, b.full_name ?? addr.full_name, b.line1 ?? addr.line1, b.city ?? addr.city, b.state ?? addr.state, b.zip ?? addr.zip, b.country ?? addr.country, b.phone ?? addr.phone, b.is_default ? 1 : addr.is_default, addr.id);
    sendJSON(res, 200, { ok: true });
  });

  router.del('/api/addresses/:id', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(ctx.params.id, user.id);
    sendJSON(res, 200, { ok: true });
  });

  // Payment methods (mock)
  router.get('/api/payment-methods', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const rows = db.prepare('SELECT * FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(user.id);
    sendJSON(res, 200, { payment_methods: rows });
  });

  router.post('/api/payment-methods', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const b = await readBody(req);
    const cardNumber = (b.card_number || '').replace(/\s+/g, '');
    if (cardNumber.length < 12) return sendJSON(res, 400, { error: 'Enter a valid card number.' });
    const last4 = cardNumber.slice(-4);
    const brand = cardNumber.startsWith('4') ? 'Visa' : cardNumber.startsWith('5') ? 'Mastercard' : 'Card';
    const countExisting = db.prepare('SELECT COUNT(*) c FROM payment_methods WHERE user_id = ?').get(user.id).c;
    if (b.is_default) db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(user.id);
    const info = db.prepare('INSERT INTO payment_methods (user_id, brand, last4, expiry, is_default) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, brand, last4, b.expiry || '', (b.is_default || countExisting === 0) ? 1 : 0);
    // never store raw card number
    sendJSON(res, 201, { id: info.lastInsertRowid, brand, last4 });
  });

  router.del('/api/payment-methods/:id', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?').run(ctx.params.id, user.id);
    sendJSON(res, 200, { ok: true });
  });
}

module.exports = { register, requireAuth };
