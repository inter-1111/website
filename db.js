const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'marketplace.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  brand_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  cover_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  discount_price REAL,
  sku TEXT,
  featured INTEGER DEFAULT 0,
  trending INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  size TEXT,
  color TEXT,
  stock INTEGER DEFAULT 0,
  sku TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  variant_id INTEGER,
  qty INTEGER NOT NULL DEFAULT 1,
  saved_for_later INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  label TEXT,
  full_name TEXT,
  line1 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT,
  phone TEXT,
  is_default INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  brand TEXT,
  last4 TEXT,
  expiry TEXT,
  is_default INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Processing',
  subtotal REAL NOT NULL,
  shipping REAL NOT NULL,
  total REAL NOT NULL,
  address_snapshot TEXT,
  payment_snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  brand_id INTEGER,
  product_name TEXT,
  brand_name TEXT,
  image_url TEXT,
  size TEXT,
  color TEXT,
  qty INTEGER,
  price REAL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT,
  message TEXT,
  reply TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

function seedCategories() {
  const top = [
    { name: 'Abayas', slug: 'abayas' },
    { name: 'Dresses', slug: 'dresses' },
    { name: 'Tunics & Kaftans', slug: 'tunics-kaftans' },
    { name: 'Tops & Blouses', slug: 'tops-blouses' },
    { name: 'Skirts', slug: 'skirts' },
    { name: 'Pants & Trousers', slug: 'pants-trousers' },
    { name: 'Modest Sets', slug: 'modest-sets' },
    { name: 'Outerwear', slug: 'outerwear' },
    { name: 'Hijabs & Scarves', slug: 'hijabs-scarves' },
    { name: 'Loungewear', slug: 'loungewear' },
    { name: 'Accessories', slug: 'accessories' },
  ];

  const existing = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (existing.c > 0) return;

  const insertCat = db.prepare('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?, ?, ?, ?)');
  top.forEach((t, i) => insertCat.run(t.name, t.slug, null, i));
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (existing) return;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword('Admin123!', salt);
  db.prepare('INSERT INTO users (name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
    .run('Owner', 'admin@marketplace.local', hash, salt, 'admin');
}

seedCategories();
seedAdmin();

module.exports = { db, hashPassword };
