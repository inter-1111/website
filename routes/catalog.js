const { db } = require('../db');
const { sendJSON } = require('../util');

function withImage(product) {
  const img = db.prepare('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC LIMIT 1').get(product.id);
  return { ...product, image: img ? img.url : null };
}

function register(router) {
  router.get('/api/categories', async (req, res) => {
    const tops = db.prepare('SELECT * FROM categories WHERE parent_id IS NULL ORDER BY sort_order').all();
    const tree = tops.map(t => ({
      ...t,
      children: db.prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order').all(t.id),
    }));
    sendJSON(res, 200, { categories: tree });
  });

  router.get('/api/brands', async (req, res) => {
    const brands = db.prepare('SELECT * FROM brands ORDER BY name').all();
    const withCounts = brands.map(b => {
      const c = db.prepare('SELECT COUNT(*) as c FROM products WHERE brand_id = ? AND active = 1').get(b.id);
      return { ...b, product_count: c.c };
    });
    sendJSON(res, 200, { brands: withCounts });
  });

  router.get('/api/brands/:slug', async (req, res, ctx) => {
    const brand = db.prepare('SELECT * FROM brands WHERE slug = ?').get(ctx.params.slug);
    if (!brand) return sendJSON(res, 404, { error: 'Brand not found.' });
    const products = db.prepare('SELECT * FROM products WHERE brand_id = ? AND active = 1 ORDER BY created_at DESC').all(brand.id).map(withImage);
    sendJSON(res, 200, { brand, products });
  });
}

module.exports = { register, withImage };
