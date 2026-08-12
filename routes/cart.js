const { db } = require('../db');
const { sendJSON, readBody } = require('../util');

function getCartPayload(sessionToken) {
  const items = db.prepare(`
    SELECT ci.id as cart_item_id, ci.qty, ci.saved_for_later, ci.variant_id,
           p.id as product_id, p.name, p.price, p.discount_price, p.slug,
           b.id as brand_id, b.name as brand_name, v.size, v.color, v.stock
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_variants v ON v.id = ci.variant_id
    WHERE ci.session_token = ?
    ORDER BY ci.created_at DESC
  `).all(sessionToken);

  const withImages = items.map(it => {
    const img = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order LIMIT 1').get(it.product_id);
    const unitPrice = it.discount_price || it.price;
    return { ...it, image: img ? img.url : null, unit_price: unitPrice, line_total: unitPrice * it.qty };
  });

  const active = withImages.filter(i => !i.saved_for_later);
  const saved = withImages.filter(i => i.saved_for_later);
  const subtotal = active.reduce((s, i) => s + i.line_total, 0);
  const shipping = active.length === 0 ? 0 : (subtotal >= 1500 ? 0 : 60);
  const total = subtotal + shipping;

  return { items: active, saved_items: saved, subtotal, shipping, total, count: active.reduce((s, i) => s + i.qty, 0) };
}

function register(router) {
  router.get('/api/cart', async (req, res, ctx) => {
    sendJSON(res, 200, getCartPayload(ctx.session.token));
  });

  router.post('/api/cart', async (req, res, ctx) => {
    const body = await readBody(req);
    const { productId, variantId, qty } = body;
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    const quantity = Math.max(1, Number(qty) || 1);

    const existing = db.prepare('SELECT * FROM cart_items WHERE session_token = ? AND product_id = ? AND (variant_id IS ? OR variant_id = ?) AND saved_for_later = 0')
      .get(ctx.session.token, productId, variantId || null, variantId || null);

    if (existing) {
      db.prepare('UPDATE cart_items SET qty = qty + ? WHERE id = ?').run(quantity, existing.id);
    } else {
      db.prepare('INSERT INTO cart_items (session_token, product_id, variant_id, qty) VALUES (?, ?, ?, ?)')
        .run(ctx.session.token, productId, variantId || null, quantity);
    }
    sendJSON(res, 200, getCartPayload(ctx.session.token));
  });

  router.put('/api/cart/:itemId', async (req, res, ctx) => {
    const body = await readBody(req);
    const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND session_token = ?').get(ctx.params.itemId, ctx.session.token);
    if (!item) return sendJSON(res, 404, { error: 'Cart item not found.' });
    if (body.qty !== undefined) {
      const q = Math.max(1, Number(body.qty) || 1);
      db.prepare('UPDATE cart_items SET qty = ? WHERE id = ?').run(q, item.id);
    }
    if (body.saved_for_later !== undefined) {
      db.prepare('UPDATE cart_items SET saved_for_later = ? WHERE id = ?').run(body.saved_for_later ? 1 : 0, item.id);
    }
    sendJSON(res, 200, getCartPayload(ctx.session.token));
  });

  router.del('/api/cart/:itemId', async (req, res, ctx) => {
    db.prepare('DELETE FROM cart_items WHERE id = ? AND session_token = ?').run(ctx.params.itemId, ctx.session.token);
    sendJSON(res, 200, getCartPayload(ctx.session.token));
  });
}

module.exports = { register, getCartPayload };

