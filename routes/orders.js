const { db } = require('../db');
const { sendJSON, readBody } = require('../util');
const { requireAuth } = require('./account');
const { getCartPayload } = require('./cart');

const STATUS_FLOW = ['Processing', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered'];

function genOrderNumber() {
  return 'ORD-' + Date.now().toString().slice(-8) + '-' + Math.floor(Math.random() * 900 + 100);
}

function register(router) {
  router.post('/api/orders', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const body = await readBody(req);
    const cart = getCartPayload(ctx.session.token);
    if (cart.items.length === 0) return sendJSON(res, 400, { error: 'Your cart is empty.' });

    let address = null;
    if (body.addressId) address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(body.addressId, user.id);
    else if (body.address) address = body.address;
    if (!address) return sendJSON(res, 400, { error: 'A shipping address is required.' });

    let paymentLabel = 'Mock Payment';
    if (body.paymentMethodId) {
      const pm = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND user_id = ?').get(body.paymentMethodId, user.id);
      if (pm) paymentLabel = `${pm.brand} •••• ${pm.last4}`;
    } else if (body.mockCardLast4) {
      paymentLabel = `Card •••• ${String(body.mockCardLast4).slice(-4)}`;
    }

    const orderNumber = genOrderNumber();
    const info = db.prepare(`INSERT INTO orders (order_number, user_id, status, subtotal, shipping, total, address_snapshot, payment_snapshot)
      VALUES (?, ?, 'Processing', ?, ?, ?, ?, ?)`)
      .run(orderNumber, user.id, cart.subtotal, cart.shipping, cart.total, JSON.stringify(address), paymentLabel);

    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, brand_id, product_name, brand_name, image_url, size, color, qty, price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    cart.items.forEach(it => {
      insertItem.run(orderId, it.product_id, it.brand_id, it.name, it.brand_name, it.image, it.size, it.color, it.qty, it.unit_price);
    });

    db.prepare('DELETE FROM cart_items WHERE session_token = ? AND saved_for_later = 0').run(ctx.session.token);

    sendJSON(res, 201, { orderId, orderNumber });
  });

  router.get('/api/orders', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
    const withCounts = orders.map(o => {
      const c = db.prepare('SELECT COUNT(*) c, SUM(qty) q FROM order_items WHERE order_id = ?').get(o.id);
      return { ...o, item_count: c.q || 0 };
    });
    sendJSON(res, 200, { orders: withCounts });
  });

  router.get('/api/orders/:id', async (req, res, ctx) => {
    const user = requireAuth(ctx, res); if (!user) return;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(ctx.params.id, user.id);
    if (!order) return sendJSON(res, 404, { error: 'Order not found.' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    sendJSON(res, 200, { order: { ...order, address: JSON.parse(order.address_snapshot || '{}') }, items });
  });
}

module.exports = { register, STATUS_FLOW };
