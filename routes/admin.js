const crypto = require('crypto');
const { db, hashPassword } = require('../db');
const { sendJSON, readBody, getCurrentUser } = require('../util');

// Owner: role === 'admin' (full access to everything).
// Brand admin: role === 'brand_admin' with a brand_id (scoped to their own
// brand's products and to orders containing at least one of their items).
function requireStaff(ctx, res) {
  const user = getCurrentUser(ctx.session);
  if (!user || (user.role !== 'admin' && user.role !== 'brand_admin')) {
    sendJSON(res, 403, { error: 'Admin access required.' });
    return null;
  }
  return user;
}

function requireOwner(ctx, res) {
  const user = getCurrentUser(ctx.session);
  if (!user || user.role !== 'admin') { sendJSON(res, 403, { error: 'Owner access required.' }); return null; }
  return user;
}

function isOwner(user) { return user.role === 'admin'; }

function slugify(str) {
  return String(str).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function register(router) {
  // ---- Stats ----
  router.get('/api/admin/stats', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;

    if (isOwner(user)) {
      const stats = {
        total_orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
        total_products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
        active_brands: db.prepare('SELECT COUNT(*) c FROM brands').get().c,
        registered_users: db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'user'").get().c,
        revenue: db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status != 'Cancelled'").get().t,
        low_stock: db.prepare('SELECT COUNT(*) c FROM product_variants WHERE stock > 0 AND stock <= 3').get().c,
        out_of_stock: db.prepare('SELECT COUNT(*) c FROM product_variants WHERE stock = 0').get().c,
      };
      const recentOrders = db.prepare('SELECT o.*, u.name as user_name FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 5').all();
      return sendJSON(res, 200, { stats, recentOrders });
    }

    // Brand admin: scoped stats for just their own brand.
    const bId = user.brand_id;
    const stats = {
      total_orders: db.prepare('SELECT COUNT(DISTINCT order_id) c FROM order_items WHERE brand_id = ?').get(bId).c,
      total_products: db.prepare('SELECT COUNT(*) c FROM products WHERE brand_id = ?').get(bId).c,
      active_brands: 1,
      registered_users: 0,
      revenue: db.prepare(`SELECT COALESCE(SUM(oi.price * oi.qty),0) t FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.brand_id = ? AND o.status != 'Cancelled'`).get(bId).t,
      low_stock: db.prepare('SELECT COUNT(*) c FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.brand_id = ? AND v.stock > 0 AND v.stock <= 3').get(bId).c,
      out_of_stock: db.prepare('SELECT COUNT(*) c FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.brand_id = ? AND v.stock = 0').get(bId).c,
    };
    const recentOrders = db.prepare(`
      SELECT DISTINCT o.*, u.name as user_name FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN users u ON u.id = o.user_id
      WHERE oi.brand_id = ? ORDER BY o.created_at DESC LIMIT 5
    `).all(bId);
    sendJSON(res, 200, { stats, recentOrders });
  });

  // ---- Brands ----
  // Only the owner can create/delete brands or edit brands other than their
  // own. A brand admin may view and edit their own brand's profile info.
  router.get('/api/admin/brands', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    if (isOwner(user)) return sendJSON(res, 200, { brands: db.prepare('SELECT * FROM brands ORDER BY name').all() });
    const own = db.prepare('SELECT * FROM brands WHERE id = ?').all(user.brand_id);
    sendJSON(res, 200, { brands: own });
  });

  router.post('/api/admin/brands', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const b = await readBody(req);
    if (!b.name) return sendJSON(res, 400, { error: 'Brand name is required.' });
    const slug = b.slug ? slugify(b.slug) : slugify(b.name);
    try {
      const info = db.prepare('INSERT INTO brands (name, slug, description, logo_url, cover_url) VALUES (?, ?, ?, ?, ?)')
        .run(b.name, slug, b.description || '', b.logo_url || '', b.cover_url || '');
      sendJSON(res, 201, { id: info.lastInsertRowid, slug });
    } catch (e) { sendJSON(res, 409, { error: 'A brand with this slug already exists.' }); }
  });

  router.put('/api/admin/brands/:id', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(ctx.params.id);
    if (!brand) return sendJSON(res, 404, { error: 'Brand not found.' });
    const b = await readBody(req);
    const nextSlug = b.slug ? slugify(b.slug) : brand.slug;
    db.prepare('UPDATE brands SET name=?, slug=?, description=?, logo_url=?, cover_url=? WHERE id=?')
      .run(b.name ?? brand.name, nextSlug, b.description ?? brand.description, b.logo_url ?? brand.logo_url, b.cover_url ?? brand.cover_url, brand.id);
    sendJSON(res, 200, { ok: true });
  });

  router.del('/api/admin/brands/:id', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    db.prepare('DELETE FROM brands WHERE id = ?').run(ctx.params.id);
    sendJSON(res, 200, { ok: true });
  });

  // ---- Categories (owner only) ----
  router.get('/api/admin/categories', async (req, res, ctx) => {
    if (!requireStaff(ctx, res)) return;
    sendJSON(res, 200, { categories: db.prepare('SELECT * FROM categories ORDER BY parent_id IS NULL DESC, parent_id, sort_order').all() });
  });

  router.post('/api/admin/categories', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const b = await readBody(req);
    if (!b.name) return sendJSON(res, 400, { error: 'Category name is required.' });
    const slug = b.slug ? slugify(b.slug) : slugify((b.parent_id ? `${b.parent_id}-` : '') + b.name);
    try {
      const info = db.prepare('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?, ?, ?, ?)')
        .run(b.name, slug, b.parent_id || null, b.sort_order || 0);
      sendJSON(res, 201, { id: info.lastInsertRowid, slug });
    } catch (e) { sendJSON(res, 409, { error: 'A category with this slug already exists.' }); }
  });

  router.put('/api/admin/categories/:id', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(ctx.params.id);
    if (!cat) return sendJSON(res, 404, { error: 'Category not found.' });
    const b = await readBody(req);
    if (b.parent_id && Number(b.parent_id) === cat.id) return sendJSON(res, 400, { error: 'A category cannot be its own parent.' });
    const nextSlug = b.slug ? slugify(b.slug) : cat.slug;
    try {
      db.prepare('UPDATE categories SET name=?, slug=?, parent_id=?, sort_order=? WHERE id=?')
        .run(b.name ?? cat.name, nextSlug, b.parent_id !== undefined ? (b.parent_id || null) : cat.parent_id, b.sort_order ?? cat.sort_order, cat.id);
      sendJSON(res, 200, { ok: true });
    } catch (e) { sendJSON(res, 409, { error: 'A category with this slug already exists.' }); }
  });

  router.del('/api/admin/categories/:id', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    db.prepare('DELETE FROM categories WHERE id = ?').run(ctx.params.id);
    sendJSON(res, 200, { ok: true });
  });

  // ---- Products ----
  // Owner sees/edits everything. Brand admins only ever see and touch
  // products belonging to their own brand_id — enforced server-side on
  // every read and write below, not just hidden in the UI.
  router.get('/api/admin/products', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const base = `SELECT p.*, b.name as brand_name, c.name as category_name FROM products p
      JOIN brands b ON b.id = p.brand_id JOIN categories c ON c.id = p.category_id`;
    const rows = isOwner(user)
      ? db.prepare(base + ' ORDER BY p.created_at DESC').all()
      : db.prepare(base + ' WHERE p.brand_id = ? ORDER BY p.created_at DESC').all(user.brand_id);
    sendJSON(res, 200, { products: rows });
  });

  router.get('/api/admin/products/:id', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    if (!isOwner(user) && product.brand_id !== user.brand_id) return sendJSON(res, 403, { error: 'You can only manage your own brand\'s products.' });
    const images = db.prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order').all(product.id);
    const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(product.id);
    sendJSON(res, 200, { product, images, variants });
  });

  router.post('/api/admin/products', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const b = await readBody(req);
    // Brand admins can only ever create products under their own brand,
    // regardless of what brand_id the client sends.
    const brandId = isOwner(user) ? b.brand_id : user.brand_id;
    if (!b.name || !brandId || !b.category_id || !b.price) return sendJSON(res, 400, { error: 'Name, brand, category and price are required.' });
    const slug = b.slug ? slugify(b.slug) : slugify(b.name + '-' + Math.random().toString(36).slice(2, 6));
    const info = db.prepare(`INSERT INTO products (brand_id, category_id, name, slug, description, price, discount_price, sku, featured, trending, is_new, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(brandId, b.category_id, b.name, slug, b.description || '', b.price, b.discount_price || null, b.sku || '', b.featured ? 1 : 0, b.trending ? 1 : 0, b.is_new === false ? 0 : 1, b.active === false ? 0 : 1);
    const productId = info.lastInsertRowid;

    (b.images || []).forEach((url, i) => {
      if (url) db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)').run(productId, url, i);
    });
    (b.variants || []).forEach(v => {
      db.prepare('INSERT INTO product_variants (product_id, size, color, stock, sku) VALUES (?, ?, ?, ?, ?)')
        .run(productId, v.size || '', v.color || '', Number(v.stock) || 0, v.sku || '');
    });

    sendJSON(res, 201, { id: productId, slug });
  });

  router.put('/api/admin/products/:id', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    if (!isOwner(user) && product.brand_id !== user.brand_id) return sendJSON(res, 403, { error: 'You can only manage your own brand\'s products.' });
    const b = await readBody(req);
    // Brand admins cannot move a product to a different brand.
    const nextBrandId = isOwner(user) ? (b.brand_id ?? product.brand_id) : product.brand_id;
    db.prepare(`UPDATE products SET brand_id=?, category_id=?, name=?, slug=?, description=?, price=?, discount_price=?, sku=?, featured=?, trending=?, is_new=?, active=? WHERE id=?`)
      .run(
        nextBrandId, b.category_id ?? product.category_id, b.name ?? product.name,
        b.slug ? slugify(b.slug) : product.slug, b.description ?? product.description, b.price ?? product.price,
        b.discount_price ?? product.discount_price, b.sku ?? product.sku,
        b.featured !== undefined ? (b.featured ? 1 : 0) : product.featured,
        b.trending !== undefined ? (b.trending ? 1 : 0) : product.trending,
        b.is_new !== undefined ? (b.is_new ? 1 : 0) : product.is_new,
        b.active !== undefined ? (b.active ? 1 : 0) : product.active,
        product.id
      );

    if (b.images) {
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(product.id);
      b.images.forEach((url, i) => { if (url) db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?, ?, ?)').run(product.id, url, i); });
    }
    if (b.variants) {
      db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.id);
      b.variants.forEach(v => db.prepare('INSERT INTO product_variants (product_id, size, color, stock, sku) VALUES (?, ?, ?, ?, ?)')
        .run(product.id, v.size || '', v.color || '', Number(v.stock) || 0, v.sku || ''));
    }
    sendJSON(res, 200, { ok: true });
  });

  router.del('/api/admin/products/:id', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
    if (!product) return sendJSON(res, 404, { error: 'Product not found.' });
    if (!isOwner(user) && product.brand_id !== user.brand_id) return sendJSON(res, 403, { error: 'You can only manage your own brand\'s products.' });
    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    sendJSON(res, 200, { ok: true });
  });

  // ---- Orders ----
  // Owner sees full orders. Brand admins only ever see orders that contain
  // at least one of their own items, and only the line items belonging to
  // their brand — never another brand's items in the same cart/order.
  router.get('/api/admin/orders', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    if (isOwner(user)) {
      const orders = db.prepare('SELECT o.*, u.name as user_name, u.email as user_email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC').all();
      return sendJSON(res, 200, { orders });
    }
    const orders = db.prepare(`
      SELECT DISTINCT o.*, u.name as user_name, u.email as user_email FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN users u ON u.id = o.user_id
      WHERE oi.brand_id = ? ORDER BY o.created_at DESC
    `).all(user.brand_id);
    sendJSON(res, 200, { orders });
  });

  router.get('/api/admin/orders/:id', async (req, res, ctx) => {
    const user = requireStaff(ctx, res); if (!user) return;
    const order = db.prepare('SELECT o.*, u.name as user_name, u.email as user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(ctx.params.id);
    if (!order) return sendJSON(res, 404, { error: 'Order not found.' });

    if (isOwner(user)) {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return sendJSON(res, 200, { order: { ...order, address: JSON.parse(order.address_snapshot || '{}') }, items });
    }

    // Brand admin: only their own items from this order, and only if the
    // order actually contains at least one of them.
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND brand_id = ?').all(order.id, user.brand_id);
    if (!items.length) return sendJSON(res, 403, { error: 'This order does not contain any items from your brand.' });
    sendJSON(res, 200, { order: { ...order, address: JSON.parse(order.address_snapshot || '{}') }, items });
  });

  router.put('/api/admin/orders/:id/status', async (req, res, ctx) => {
    // Status updates affect the whole order (shared shipment), so this stays
    // owner-only — a brand admin changing status could mark a multi-brand
    // order "Delivered" before other brands' items have even shipped.
    if (!requireOwner(ctx, res)) return;
    const b = await readBody(req);
    const valid = ['Processing', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
    if (!valid.includes(b.status)) return sendJSON(res, 400, { error: 'Invalid status.' });
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(b.status, ctx.params.id);
    sendJSON(res, 200, { ok: true });
  });

  // ---- Users & brand-admin management (owner only) ----
  router.get('/api/admin/users', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.brand_id, b.name as brand_name, u.created_at
      FROM users u LEFT JOIN brands b ON b.id = u.brand_id ORDER BY u.created_at DESC
    `).all();
    sendJSON(res, 200, { users });
  });

  // Owner creates a brand-admin (or another owner) account directly.
  router.post('/api/admin/users', async (req, res, ctx) => {
    if (!requireOwner(ctx, res)) return;
    const b = await readBody(req);
    const { name, email, password, role } = b;
    if (!name || !email || !password) return sendJSON(res, 400, { error: 'Name, email and password are required.' });
    if (password.length < 6) return sendJSON(res, 400, { error: 'Password must be at least 6 characters.' });
    if (!['admin', 'brand_admin', 'user'].includes(role)) return sendJSON(res, 400, { error: 'Invalid role.' });
    if (role === 'brand_admin' && !b.brand_id) return sendJSON(res, 400, { error: 'A brand must be selected for a brand admin.' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return sendJSON(res, 409, { error: 'An account with this email already exists.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const info = db.prepare('INSERT INTO users (name, email, password_hash, salt, phone, role, brand_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name, email.toLowerCase(), hash, salt, b.phone || null, role, role === 'brand_admin' ? b.brand_id : null);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  });

  // Owner promotes/demotes a user, or reassigns a brand admin to a
  // different brand.
  router.put('/api/admin/users/:id', async (req, res, ctx) => {
    const owner = requireOwner(ctx, res); if (!owner) return;
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
    if (!target) return sendJSON(res, 404, { error: 'User not found.' });
    const b = await readBody(req);
    const role = b.role ?? target.role;
    if (!['admin', 'brand_admin', 'user'].includes(role)) return sendJSON(res, 400, { error: 'Invalid role.' });
    if (role === 'brand_admin' && !(b.brand_id ?? target.brand_id)) return sendJSON(res, 400, { error: 'A brand must be selected for a brand admin.' });
    const brandId = role === 'brand_admin' ? (b.brand_id ?? target.brand_id) : null;
    db.prepare('UPDATE users SET role = ?, brand_id = ? WHERE id = ?').run(role, brandId, target.id);
    sendJSON(res, 200, { ok: true });
  });

  router.del('/api/admin/users/:id', async (req, res, ctx) => {
    const owner = requireOwner(ctx, res); if (!owner) return;
    if (Number(ctx.params.id) === owner.id) return sendJSON(res, 400, { error: "You can't delete your own account." });
    db.prepare('DELETE FROM users WHERE id = ?').run(ctx.params.id);
    sendJSON(res, 200, { ok: true });
  });
}

module.exports = { register, requireStaff, requireOwner, isOwner };
