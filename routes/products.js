const { db } = require('../db');
const { sendJSON } = require('../util');
const { withImage } = require('./catalog');

function parseQuery(url) {
  const q = {};
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return q;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  for (const [k, v] of params.entries()) {
    if (q[k] !== undefined) {
      q[k] = Array.isArray(q[k]) ? [...q[k], v] : [q[k], v];
    } else q[k] = v;
  }
  return q;
}

function buildProductQuery(q) {
  let sql = `SELECT DISTINCT p.* FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN brands b ON b.id = p.brand_id
    WHERE p.active = 1`;
  const args = [];

  if (q.category) {
    sql += ` AND (c.slug = ? OR c.slug LIKE ('%-' || ?) OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))`;
    args.push(q.category, q.category, q.category);
  }
  if (q.brand) { sql += ` AND b.slug = ?`; args.push(q.brand); }
  if (q.gender) { sql += ` AND (c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))`; args.push(q.gender, q.gender); }
  if (q.size) { sql += ` AND v.size = ?`; args.push(q.size); }
  if (q.color) { sql += ` AND v.color = ?`; args.push(q.color); }
  if (q.minPrice) { sql += ` AND COALESCE(p.discount_price, p.price) >= ?`; args.push(Number(q.minPrice)); }
  if (q.maxPrice) { sql += ` AND COALESCE(p.discount_price, p.price) <= ?`; args.push(Number(q.maxPrice)); }
  if (q.availability === 'in_stock') { sql += ` AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock > 0)`; }
  if (q.featured) { sql += ` AND p.featured = 1`; }
  if (q.trending) { sql += ` AND p.trending = 1`; }
  if (q.isNew) { sql += ` AND p.is_new = 1`; }
  if (q.q) {
    sql += ` AND (p.name LIKE ? OR p.description LIKE ? OR b.name LIKE ? OR c.name LIKE ?)`;
    const like = `%${q.q}%`;
    args.push(like, like, like, like);
  }
  if (q.excludeId) { sql += ` AND p.id != ?`; args.push(Number(q.excludeId)); }

  switch (q.sort) {
    case 'newest': sql += ' ORDER BY p.created_at DESC'; break;
    case 'popular': sql += ' ORDER BY p.trending DESC, p.created_at DESC'; break;
    case 'price_asc': sql += ' ORDER BY COALESCE(p.discount_price, p.price) ASC'; break;
    case 'price_desc': sql += ' ORDER BY COALESCE(p.discount_price, p.price) DESC'; break;
    default: sql += ' ORDER BY p.featured DESC, p.created_at DESC';
  }

  if (q.limit) { sql += ` LIMIT ${Number(q.limit) || 24}`; }
  else sql += ' LIMIT 60';

  return { sql, args };
}

function fullProduct(row) {
  const brand = db.prepare('SELECT id, name, slug, logo_url FROM brands WHERE id = ?').get(row.brand_id);
  const category = db.prepare('SELECT id, name, slug, parent_id FROM categories WHERE id = ?').get(row.category_id);
  const images = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order').all(row.id).map(i => i.url);
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(row.id);
  const sizes = [...new Set(variants.map(v => v.size).filter(Boolean))];
  const colors = [...new Set(variants.map(v => v.color).filter(Boolean))];
  const totalStock = variants.reduce((s, v) => s + (v.stock || 0), 0);
  return { ...row, brand, category, images, variants, sizes, colors, in_stock: totalStock > 0 };
}

function register(router) {
  router.get('/api/products', async (req, res) => {
    const q = parseQuery(req.url);
    const { sql, args } = buildProductQuery(q);
    const rows = db.prepare(sql).all(...args);
    sendJSON(res, 200, { products: rows.map(withImage), count: rows.length });
  });

  router.get('/api/products/:id', async (req, res, ctx) => {
    const id = ctx.params.id;
    let row;
    if (/^\d+$/.test(id)) row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id));
    else row = db.prepare('SELECT * FROM products WHERE slug = ?').get(id);
    if (!row) return sendJSON(res, 404, { error: 'Product not found.' });
    const product = fullProduct(row);
    const related = db.prepare('SELECT * FROM products WHERE category_id = ? AND id != ? AND active = 1 LIMIT 8')
      .all(row.category_id, row.id).map(withImage);
    sendJSON(res, 200, { product, related });
  });
}

module.exports = { register, buildProductQuery, parseQuery, fullProduct };

