const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT,
  button_text TEXT DEFAULT 'Shop Collection',
  button_link TEXT DEFAULT '#collections',
  image TEXT,
  bg_color TEXT DEFAULT '#0a1128',
  text_color TEXT DEFAULT '#ffffff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  price REAL NOT NULL,
  old_price REAL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  banner_id INTEGER REFERENCES banners(id) ON DELETE SET NULL,
  badge TEXT,
  color TEXT DEFAULT '#228B22',
  image TEXT DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',
  stock INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  shipping_name TEXT,
  shipping_email TEXT,
  shipping_address TEXT,
  shipping_city TEXT,
  shipping_zip TEXT,
  instagram TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  quantity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caption TEXT,
  image TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percentage', -- 'percentage' or 'fixed'
  discount_value REAL NOT NULL,
  min_order REAL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migration helpers
try { db.exec("ALTER TABLE products ADD COLUMN image TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE products ADD COLUMN views INTEGER NOT NULL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE products ADD COLUMN banner_id INTEGER REFERENCES banners(id) ON DELETE SET NULL"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN instagram TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN whatsapp TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0"); } catch(e) {}

// New table for user favorites (wish list)
try { db.exec(`
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);
`); } catch(e) {}

// Seed demo admin


// Seed demo admin & categories & banners if empty
function seed() {
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@londonluxe.test');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run('Store Admin', 'admin@londonluxe.test', hash, 'admin');
  }

  // Insert default settings
  const insSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  insSetting.run('site_name', 'London Luxe');
  insSetting.run('site_tagline', 'Luxury Bags & Fine Jewelry');
  insSetting.run('instagram_handle', 'londonluxe.official');
  insSetting.run('whatsapp_number', '447000000000');
  insSetting.run('contact_email', 'hello@londonluxe.test');

  const bannerCount = db.prepare('SELECT COUNT(*) AS n FROM banners').get().n;
  if (bannerCount === 0) {
    db.prepare(`INSERT INTO banners (title, subtitle, button_text, button_link, bg_color, text_color, active)
      VALUES (?,?,?,?,?,?,1)`)
      .run(
        'Black Friday Exclusive Collection 🖤',
        'Limited edition midnight leather bags & bespoke diamond jewelry at up to 40% off.',
        'Shop Black Friday Edit',
        '#collections',
        'linear-gradient(135deg, #09090b 0%, #18181b 50%, #b45309 100%)',
        '#ffffff'
      );
    db.prepare(`INSERT INTO banners (title, subtitle, button_text, button_link, bg_color, text_color, active)
      VALUES (?,?,?,?,?,?,1)`)
      .run(
        'Royal Summer Bridal Gala 💎',
        'Handcrafted tiaras and genuine freshwater pearls created for your unforgettable moment.',
        'Explore Bridal Gala',
        '#collections',
        'linear-gradient(135deg, #0a1128 0%, #1e3a8a 50%, #0d9488 100%)',
        '#ffffff'
      );
  }

  // Seed demo coupons if empty
  const couponCount = db.prepare('SELECT COUNT(*) AS n FROM coupons').get().n;
  if (couponCount === 0) {
    const insCoupon = db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order, active) VALUES (?,?,?,?,1)');
    insCoupon.run('LUXE10', 'percentage', 10, 50);
    insCoupon.run('VIP50', 'fixed', 50, 200);
  }
}

seed();
module.exports = db;
