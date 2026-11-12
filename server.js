const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- helpers ---------------- */
const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';

function uniqueSlug(base, ignoreId = null) {
  let slug = base, i = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
    if (!row || row.id === ignoreId) return slug;
    slug = `${base}-${i++}`;
  }
}

const serializeProduct = (p) => {
  let features = [];
  try { features = JSON.parse(p.features || '[]'); } catch { /* noop */ }
  return { ...p, features };
};

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Please sign in first.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Session expired.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies.token;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(payload.id);
    } catch {}
  }
  next();
}

const adminOnly = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access only.' });

const setToken = (res, user) => {
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
};

/* ---------------- image upload route ---------------- */
app.post('/api/upload', auth, adminOnly, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({ url: '/uploads/' + req.file.filename });
});

/* ---------------- auth ---------------- */
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const mail = email.toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail))
    return res.status(409).json({ error: 'This email is already registered.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)').run(name, mail, hash);
  const user = { id: Number(info.lastInsertRowid), name, email: mail, role: 'customer' };
  setToken(res, user);
  res.status(201).json({ user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!row || !bcrypt.compareSync(password, row.password_hash))
    return res.status(401).json({ error: 'Invalid email or password.' });
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  setToken(res, user);
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ---------------- banners ---------------- */
app.get('/api/banners', (req, res) => {
  const banners = db.prepare('SELECT * FROM banners WHERE active = 1 ORDER BY id DESC').all();
  res.json(banners);
});

app.get('/api/admin/banners', auth, adminOnly, (req, res) => {
  const banners = db.prepare(`SELECT b.*, COUNT(p.id) AS product_count
    FROM banners b
    LEFT JOIN products p ON p.banner_id = b.id
    GROUP BY b.id
    ORDER BY b.id DESC`).all();
  res.json(banners);
});

app.post('/api/admin/banners', auth, adminOnly, (req, res) => {
  const { title, subtitle, button_text, button_link, image, bg_color, text_color, active } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  const info = db.prepare(`INSERT INTO banners
    (title, subtitle, button_text, button_link, image, bg_color, text_color, active)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(
      title,
      subtitle || '',
      button_text || 'Shop Now',
      button_link || '#collections',
      image || '',
      bg_color || '#0a1128',
      text_color || '#ffffff',
      active !== undefined ? (active ? 1 : 0) : 1
    );
  res.status(201).json(db.prepare('SELECT * FROM banners WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/admin/banners/:id', auth, adminOnly, (req, res) => {
  const { title, subtitle, button_text, button_link, image, bg_color, text_color, active } = req.body || {};
  const banner = db.prepare('SELECT * FROM banners WHERE id = ?').get(req.params.id);
  if (!banner) return res.status(404).json({ error: 'Banner not found.' });

  db.prepare(`UPDATE banners SET
    title = ?, subtitle = ?, button_text = ?, button_link = ?, image = ?,
    bg_color = ?, text_color = ?, active = ? WHERE id = ?`)
    .run(
      title || banner.title,
      subtitle !== undefined ? subtitle : banner.subtitle,
      button_text !== undefined ? button_text : banner.button_text,
      button_link !== undefined ? button_link : banner.button_link,
      image !== undefined ? image : banner.image,
      bg_color || banner.bg_color,
      text_color || banner.text_color,
      active !== undefined ? (active ? 1 : 0) : banner.active,
      req.params.id
    );
  res.json(db.prepare('SELECT * FROM banners WHERE id = ?').get(req.params.id));
});

app.delete('/api/admin/banners/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM banners WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- feedback / contact messages ---------------- */
app.post('/api/messages', optionalAuth, (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required.' });
  }
  const userId = req.user ? req.user.id : null;
  db.prepare('INSERT INTO messages (user_id, name, email, subject, message) VALUES (?,?,?,?,?)')
    .run(userId, name, email, subject || 'General Inquiry', message);
  res.status(201).json({ ok: true, message: 'Message sent successfully. Our team will contact you shortly!' });
});

app.get('/api/admin/messages', auth, adminOnly, (req, res) => {
  const msgs = db.prepare(`SELECT m.*, u.name as user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.id DESC`).all();
  res.json(msgs);
});

app.patch('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  const { status } = req.body || {};
  if (!['unread', 'read', 'replied'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/messages/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- settings (Dynamic Website Name & Socials) ---------------- */
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

app.post('/api/admin/settings', auth, adminOnly, (req, res) => {
  const { site_name, site_tagline, instagram_handle, whatsapp_number, contact_email } = req.body || {};
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    if (site_name !== undefined) upsert.run('site_name', String(site_name).trim());
    if (site_tagline !== undefined) upsert.run('site_tagline', String(site_tagline).trim());
    if (instagram_handle !== undefined) upsert.run('instagram_handle', String(instagram_handle).trim().replace(/^@/, ''));
    if (whatsapp_number !== undefined) upsert.run('whatsapp_number', String(whatsapp_number).trim().replace(/[^0-9+]/g, ''));
    if (contact_email !== undefined) upsert.run('contact_email', String(contact_email).trim());
  });
  tx();

  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

/* ---------------- admin profile & password update ---------------- */
app.put('/api/admin/profile', auth, adminOnly, (req, res) => {
  const { name, email, current_password, new_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // If changing password, verify current password
  if (new_password) {
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required to set a new password.' });
    }
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    const newHash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
  }

  // Update Name or Email
  const updatedName = name ? String(name).trim() : user.name;
  let updatedEmail = user.email;
  if (email && email.toLowerCase() !== user.email) {
    const checkEmail = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase(), user.id);
    if (checkEmail) return res.status(409).json({ error: 'This email address is already in use.' });
    updatedEmail = email.toLowerCase().trim();
  }

  db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(updatedName, updatedEmail, user.id);
  const updatedUser = { id: user.id, name: updatedName, email: updatedEmail, role: user.role };
  setToken(res, updatedUser);
  res.json({ user: updatedUser });
});

/* ---------------- categories ---------------- */
app.get('/api/categories', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c LEFT JOIN products p ON p.category_id = c.id
    GROUP BY c.id ORDER BY c.id
  `).all());
});

/* ---------------- products (with Banner linkage, Pagination max 20, Sorting, Filters) ---------------- */
app.get('/api/products', (req, res) => {
  const { category, banner_id, q, featured, sort, min_price, max_price, in_stock } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20)); // default 20 grids
  const offset = (page - 1) * limit;

  // Notice: If a product is linked to a banner (banner_id is NOT NULL),
  // hide it from public store UNLESS that banner is active!
  let baseSql = `FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 LEFT JOIN banners b ON b.id = p.banner_id
                 WHERE (p.banner_id IS NULL OR b.active = 1)`;
  const params = [];

  if (category && category !== 'all') { baseSql += ' AND c.slug = ?'; params.push(category); }
  if (banner_id) { baseSql += ' AND p.banner_id = ?'; params.push(Number(banner_id)); }
  if (q) {
    baseSql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (featured === '1') { baseSql += ' AND p.featured = 1'; }
  if (in_stock === '1') { baseSql += ' AND p.stock > 0'; }
  if (min_price) { baseSql += ' AND p.price >= ?'; params.push(Number(min_price)); }
  if (max_price) { baseSql += ' AND p.price <= ?'; params.push(Number(max_price)); }

  // Total count query
  const totalCount = db.prepare(`SELECT COUNT(*) as n ${baseSql}`).get(...params).n;

  // Sorting: If viewing banner campaign or default, prioritize products created for this banner first!
  let orderBy = ' ORDER BY (CASE WHEN p.banner_id IS NOT NULL THEN 1 ELSE 0 END) DESC, p.featured DESC, p.id DESC';
  if (sort === 'price-asc') orderBy = ' ORDER BY p.price ASC';
  else if (sort === 'price-desc') orderBy = ' ORDER BY p.price DESC';
  else if (sort === 'name-asc') orderBy = ' ORDER BY p.name ASC';
  else if (sort === 'newest') orderBy = ' ORDER BY p.id DESC';
  else if (sort === 'popular') orderBy = ' ORDER BY p.views DESC, p.featured DESC';

  const selectSql = `SELECT p.*, c.slug AS category_slug, c.name AS category_name, b.title AS banner_title ${baseSql} ${orderBy} LIMIT ? OFFSET ?`;
  const products = db.prepare(selectSql).all(...params, limit, offset).map(serializeProduct);

  const totalPages = Math.ceil(totalCount / limit) || 1;

  res.json({
    products,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
});

app.get('/api/products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found.' });
  // Increment view counter
  db.prepare('UPDATE products SET views = views + 1 WHERE id = ?').run(req.params.id);
  res.json(serializeProduct(row));
});

/* ---------------- admin: products CRUD ---------------- */
function parseProductBody(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  if (!name) throw new Error('Product name is required.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Valid price is required.');

  const features = Array.isArray(body.features)
    ? body.features.map((f) => String(f).trim()).filter(Boolean)
    : String(body.features || '').split('\n').map((f) => f.trim()).filter(Boolean);

  return {
    name,
    description: String(body.description || '').trim(),
    price,
    old_price: body.old_price ? Number(body.old_price) : null,
    category_id: body.category_id ? Number(body.category_id) : null,
    banner_id: body.banner_id ? Number(body.banner_id) : null,
    badge: body.badge ? String(body.badge).trim() : null,
    color: body.color || '#228B22',
    image: body.image ? String(body.image).trim() : '',
    features: JSON.stringify(features),
    stock: Number.isFinite(Number(body.stock)) ? Math.max(0, Number(body.stock)) : 0,
    featured: body.featured ? 1 : 0,
  };
}

app.post('/api/products', auth, adminOnly, (req, res) => {
  try {
    const data = parseProductBody(req.body);
    data.slug = uniqueSlug(slugify(data.name));
    const info = db.prepare(`INSERT INTO products
      (name, slug, description, price, old_price, category_id, banner_id, badge, color, image, features, stock, featured)
      VALUES (@name, @slug, @description, @price, @old_price, @category_id, @banner_id, @badge, @color, @image, @features, @stock, @featured)`)
      .run(data);
    res.status(201).json(serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/products/:id', auth, adminOnly, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  try {
    const data = parseProductBody(req.body);
    data.id = existing.id;
    data.slug = data.name === existing.name ? existing.slug : uniqueSlug(slugify(data.name), existing.id);
    db.prepare(`UPDATE products SET
      name=@name, slug=@slug, description=@description, price=@price, old_price=@old_price,
      category_id=@category_id, banner_id=@banner_id, badge=@badge, color=@color, image=@image, features=@features, stock=@stock, featured=@featured
      WHERE id=@id`).run(data);
    res.json(serializeProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(data.id)));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Product not found.' });
  res.json({ ok: true });
});

/* ---------------- cart ---------------- */
const cartQuery = `SELECT ci.id, ci.quantity, p.id AS product_id, p.name, p.price, p.color, p.image, p.stock
                   FROM cart_items ci JOIN products p ON p.id = ci.product_id
                   WHERE ci.user_id = ? ORDER BY ci.id`;

app.get('/api/cart', auth, (req, res) => res.json(db.prepare(cartQuery).all(req.user.id)));

app.post('/api/cart', auth, (req, res) => {
  const { product_id, quantity = 1 } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const qty = Math.max(1, Number(quantity) || 1);
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?')
    .get(req.user.id, product.id);
  const newQty = (existing?.quantity || 0) + qty;

  if (newQty > product.stock) return res.status(409).json({ error: `Only ${product.stock} left in stock.` });

  if (existing) {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?,?,?)')
      .run(req.user.id, product.id, qty);
  }
  res.status(201).json(db.prepare(cartQuery).all(req.user.id));
});

app.patch('/api/cart/:id', auth, (req, res) => {
  const item = db.prepare('SELECT ci.*, p.stock FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ? AND ci.user_id = ?')
    .get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Cart item not found.' });

  const qty = Number(req.body?.quantity);
  if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: 'Invalid quantity.' });
  if (qty > item.stock) return res.status(409).json({ error: `Only ${item.stock} left in stock.` });

  if (qty === 0) db.prepare('DELETE FROM cart_items WHERE id = ?').run(item.id);
  else db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, item.id);

  res.json(db.prepare(cartQuery).all(req.user.id));
});

app.delete('/api/cart/:id', auth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json(db.prepare(cartQuery).all(req.user.id));
});

/* ---------------- Instant Direct Buy Endpoint (Buy Now Button) ---------------- */
app.post('/api/orders/instant-buy', auth, (req, res) => {
  const { product_id, quantity = 1, shipping = {}, instagram = '', whatsapp = '' } = req.body || {};
  if (!product_id) return res.status(400).json({ error: 'Product ID is required.' });
  if (!shipping.name || !shipping.address || !shipping.city) {
    return res.status(400).json({ error: 'Name, address and city are required.' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (product.stock < quantity) return res.status(409).json({ error: `Not enough stock. Only ${product.stock} left.` });

  const total = product.price * quantity;

  const instantTx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO orders
      (user_id, total, shipping_name, shipping_email, shipping_address, shipping_city, shipping_zip, instagram, whatsapp)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, total, shipping.name, shipping.email || req.user.email, shipping.address, shipping.city, shipping.zip || '', String(instagram || ''), String(whatsapp || ''));

    const orderId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?,?,?,?,?)')
      .run(orderId, product.id, product.name, product.price, quantity);
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
      .run(quantity, product.id);

    return {
      id: orderId,
      total,
      items: [{ name: product.name, price: product.price, quantity }]
    };
  });

  try {
    const order = instantTx();
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- Cart Checkout Orders ---------------- */
const placeOrder = db.transaction((userId, shipping, instagram = '', whatsapp = '', couponCode = '', discountAmount = 0) => {
  const items = db.prepare(`SELECT ci.quantity, p.id AS product_id, p.name, p.price, p.stock
    FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?`).all(userId);

  if (!items.length) { const e = new Error('Your cart is empty.'); e.status = 400; throw e; }
  for (const it of items) {
    if (it.quantity > it.stock) {
      const e = new Error(`Not enough stock for "${it.name}".`); e.status = 409; throw e;
    }
  }

  const subtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const finalTotal = Math.max(0, subtotal - Number(discountAmount || 0));

  const info = db.prepare(`INSERT INTO orders
    (user_id, total, shipping_name, shipping_email, shipping_address, shipping_city, shipping_zip, instagram, whatsapp, coupon_code, discount_amount)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, finalTotal, shipping.name, shipping.email, shipping.address, shipping.city, shipping.zip, String(instagram || ''), String(whatsapp || ''), String(couponCode || ''), Number(discountAmount || 0));

  const orderId = Number(info.lastInsertRowid);
  const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?,?,?,?,?)');
  const updStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

  for (const it of items) {
    insItem.run(orderId, it.product_id, it.name, it.price, it.quantity);
    updStock.run(it.quantity, it.product_id);
  }
  db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
  return { id: orderId, total: finalTotal, discount_amount: discountAmount, coupon_code: couponCode, items };
});

app.post('/api/orders', auth, (req, res) => {
  const s = req.body?.shipping || {};
  const instagram = req.body?.instagram || '';
  const whatsapp = req.body?.whatsapp || '';
  const coupon_code = req.body?.coupon_code || '';
  const discount_amount = Number(req.body?.discount_amount) || 0;

  if (!s.name || !s.address || !s.city) return res.status(400).json({ error: 'Name, address and city are required.' });
  try {
    const order = placeOrder(req.user.id, {
      name: String(s.name), email: String(s.email || req.user.email),
      address: String(s.address), city: String(s.city), zip: String(s.zip || ''),
    }, instagram, whatsapp, coupon_code, discount_amount);
    res.status(201).json(order);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

/* ---------------- Customer Order History: Separated New Orders & Past Purchases ---------------- */
app.get('/api/orders/history', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

  const ordersWithItems = orders.map((o) => ({ ...o, items: items.all(o.id) }));

  // New Orders = Pending, Ongoing, Shipped
  // Past Purchases = Delivered, Received, Cancelled
  const activeOrders = ordersWithItems.filter((o) => ['pending', 'ongoing', 'processing', 'shipped'].includes(o.status.toLowerCase()));
  const pastOrders = ordersWithItems.filter((o) => !['pending', 'ongoing', 'processing', 'shipped'].includes(o.status.toLowerCase()));

  res.json({
    activeOrders,
    pastOrders,
    totalOrdersCount: orders.length
  });
});

app.get('/api/orders', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(orders.map((o) => ({ ...o, items: items.all(o.id) })));
});

/* ---------------- Public Order Tracking Endpoint ---------------- */
app.get('/api/orders/track', (req, res) => {
  try {
    const { order_id, email } = req.query;
    if (!order_id || !email) {
      return res.status(400).json({ error: 'Order ID and Email are required to track an order.' });
    }
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      return res.status(404).json({ error: 'No order found with this Order ID.' });
    }
    // Verify email against shipping_email or user account email
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(order.user_id);
    const orderEmail = (order.shipping_email || '').toLowerCase().trim();
    const userEmail = (user?.email || '').toLowerCase().trim();
    const queryEmail = String(email).toLowerCase().trim();

    if (orderEmail !== queryEmail && userEmail !== queryEmail) {
      return res.status(403).json({ error: 'The email provided does not match the order records.' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      total: order.total,
      shipping_name: order.shipping_name,
      shipping_city: order.shipping_city,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- Single Order Detail for Printable Invoice ---------------- */
app.get('/api/orders/:id/invoice', auth, (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

    res.json({ order, items, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- admin: orders & status change ---------------- */
app.get('/api/admin/orders', auth, adminOnly, (req, res) => {
  const orders = db.prepare(`SELECT o.*, u.name AS customer_name, u.email AS customer_email
    FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC`).all();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json(orders.map((o) => ({ ...o, items: items.all(o.id) })));
});

app.patch('/api/admin/orders/:id', auth, adminOnly, (req, res) => {
  const allowed = ['pending', 'ongoing', 'processing', 'shipped', 'delivered', 'received', 'cancelled'];
  const status = String(req.body?.status || '').toLowerCase();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const info = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true, status });
});

/* ---------------- admin: users ---------------- */
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.created_at,
    COUNT(DISTINCT o.id) AS order_count,
    COALESCE(SUM(o.total), 0) AS total_spent
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id DESC`).all();
  res.json(users);
});

/* ---------------- admin: statistics, trends & reports ---------------- */
app.get('/api/admin/reports', auth, adminOnly, (req, res) => {
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE status != 'cancelled'").get().total;
  const totalOrders = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
  const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'").get().count;
  const totalProducts = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;

  const dailySales = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at) AS date,
           COUNT(id) AS orders,
           COALESCE(SUM(total), 0) AS revenue
    FROM orders
    WHERE created_at >= date('now', '-7 days') AND status != 'cancelled'
    GROUP BY date
    ORDER BY date ASC
  `).all();

  const weeklySales = db.prepare(`
    SELECT strftime('%Y-W%W', created_at) AS week,
           COUNT(id) AS orders,
           COALESCE(SUM(total), 0) AS revenue
    FROM orders
    WHERE created_at >= date('now', '-60 days') AND status != 'cancelled'
    GROUP BY week
    ORDER BY week ASC
  `).all();

  const monthlySales = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month,
           COUNT(id) AS orders,
           COALESCE(SUM(total), 0) AS revenue
    FROM orders
    WHERE created_at >= date('now', '-12 months') AND status != 'cancelled'
    GROUP BY month
    ORDER BY month ASC
  `).all();

  const topProducts = db.prepare(`
    SELECT oi.product_id, oi.name,
           SUM(oi.quantity) AS units_sold,
           SUM(oi.price * oi.quantity) AS total_revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.product_id, oi.name
    ORDER BY units_sold DESC
    LIMIT 10
  `).all();

  const mostViewed = db.prepare(`
    SELECT id, name, views, stock, price, badge
    FROM products
    ORDER BY views DESC
    LIMIT 10
  `).all();

  const statusDistribution = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM orders
    GROUP BY status
  `).all();

  res.json({
    kpis: {
      revenue: totalRevenue,
      orders: totalOrders,
      users: totalUsers,
      products: totalProducts
    },
    dailySales,
    weeklySales,
    monthlySales,
    topProducts,
    mostViewed,
    statusDistribution
  });
});

/* ============================================================
   CUSTOMER REVIEWS / SOCIAL PROOF
   ============================================================ */

// GET /api/reviews — public, active reviews ordered by display_order
app.get('/api/reviews', (req, res) => {
  try {
    const reviews = db.prepare(
      "SELECT id, caption, image, display_order FROM reviews WHERE active = 1 ORDER BY display_order ASC, id ASC"
    ).all();
    res.json(reviews);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/reviews — all reviews (admin)
app.get('/api/admin/reviews', auth, adminOnly, (req, res) => {
  try {
    const reviews = db.prepare(
      "SELECT * FROM reviews ORDER BY display_order ASC, id ASC"
    ).all();
    res.json(reviews);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/reviews — create review
app.post('/api/admin/reviews', auth, adminOnly, (req, res) => {
  try {
    const { caption, image, display_order = 0, active = 1 } = req.body;
    if (!image) return res.status(400).json({ error: 'Image is required.' });
    const r = db.prepare(
      "INSERT INTO reviews (caption, image, display_order, active) VALUES (?,?,?,?)"
    ).run(caption || '', image, Number(display_order), Number(active));
    const created = db.prepare("SELECT * FROM reviews WHERE id = ?").get(r.lastInsertRowid);
    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/reviews/:id — update review
app.put('/api/admin/reviews/:id', auth, adminOnly, (req, res) => {
  try {
    const { caption, image, display_order, active } = req.body;
    const existing = db.prepare("SELECT * FROM reviews WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Review not found.' });
    db.prepare(
      "UPDATE reviews SET caption=?, image=?, display_order=?, active=? WHERE id=?"
    ).run(
      caption !== undefined ? caption : existing.caption,
      image !== undefined ? image : existing.image,
      display_order !== undefined ? Number(display_order) : existing.display_order,
      active !== undefined ? Number(active) : existing.active,
      req.params.id
    );
    res.json(db.prepare("SELECT * FROM reviews WHERE id = ?").get(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/reviews/:id — delete review
app.delete('/api/admin/reviews/:id', auth, adminOnly, (req, res) => {
  try {
    const r = db.prepare("DELETE FROM reviews WHERE id = ?").run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Review not found.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== FAVORITES (Wish List) ====================
// GET /api/favorites - list user's favorite products (requires auth)
app.get('/api/favorites', auth, async (req, res) => {
  try {
    const favorites = db.prepare(
      `SELECT f.id, f.product_id, p.name, p.price, p.image, p.slug FROM favorites f
       JOIN products p ON p.id = f.product_id
       WHERE f.user_id = ? ORDER BY f.created_at DESC`
    ).all(req.user.id);
    res.json(favorites);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/favorites - add product to favorites (requires auth)
app.post('/api/favorites', auth, (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });
    const stmt = db.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?)');
    const info = stmt.run(req.user.id, product_id);
    const fav = db.prepare('SELECT * FROM favorites WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(fav);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Already in favorites' });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/favorites/:id - remove favorite entry (requires auth)
app.delete('/api/favorites/:id', auth, (req, res) => {
  try {
    const r = db.prepare('DELETE FROM favorites WHERE (id = ? OR product_id = ?) AND user_id = ?').run(req.params.id, req.params.id, req.user.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Favorite not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ============================================================
   COUPONS & DISCOUNT SYSTEM
   ============================================================ */

// POST /api/coupons/apply - validate and apply coupon
app.post('/api/coupons/apply', auth, (req, res) => {
  try {
    const { code, subtotal = 0 } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code is required.' });

    const coupon = db.prepare('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND active = 1').get(code.trim());
    if (!coupon) return res.status(404).json({ error: 'Invalid or expired coupon code.' });

    const sub = Number(subtotal);
    if (coupon.min_order && sub < coupon.min_order) {
      return res.status(400).json({ error: `This coupon requires a minimum order of £${coupon.min_order.toFixed(2)}.` });
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (sub * coupon.discount_value) / 100;
    } else {
      discount = Math.min(coupon.discount_value, sub);
    }

    res.json({
      valid: true,
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      discount_amount: Number(discount.toFixed(2)),
      final_total: Number(Math.max(0, sub - discount).toFixed(2))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/coupons - list coupons (admin)
app.get('/api/admin/coupons', auth, adminOnly, (req, res) => {
  try {
    const coupons = db.prepare('SELECT * FROM coupons ORDER BY id DESC').all();
    res.json(coupons);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/coupons - create coupon (admin)
app.post('/api/admin/coupons', auth, adminOnly, (req, res) => {
  try {
    const { code, discount_type = 'percentage', discount_value, min_order = 0, active = 1 } = req.body;
    if (!code || !discount_value) return res.status(400).json({ error: 'Code and discount value are required.' });

    const r = db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order, active) VALUES (?,?,?,?,?)')
      .run(code.trim().toUpperCase(), discount_type, Number(discount_value), Number(min_order || 0), Number(active));
    
    const created = db.prepare('SELECT * FROM coupons WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(created);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A coupon with this code already exists.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/coupons/:id - delete coupon (admin)
app.delete('/api/admin/coupons/:id', auth, adminOnly, (req, res) => {
  try {
    const r = db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Coupon not found.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------------- fallback ---------------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

app.listen(PORT, () => console.log(`🚀 London Luxe running on http://localhost:${PORT}`));

