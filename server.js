const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { sendOrderEmail } = require('./mailer');

const PORT = process.env.PORT || 3000;
const KITCHEN_PASSWORD = process.env.KITCHEN_PASSWORD || 'kitchen';
const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'KC Home Restaurant';

const STATUSES = ['Received', 'Ready', 'Cancelled'];

if (!process.env.KITCHEN_PASSWORD) {
  console.warn('WARNING: KITCHEN_PASSWORD not set, using default "kitchen".');
}

// Lets async route handlers pass errors to Express.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const app = express();
app.set('trust proxy', true); // Render runs behind a proxy; needed for the https:// links in emails
app.use(express.json());

// Send an email for this order's current status (in the background).
async function emailCustomer(req, where, value) {
  const order = await db.get(`SELECT * FROM orders WHERE ${where} = ?`, [value]);
  if (!order) return;
  const statusUrl = `${req.protocol}://${req.get('host')}/order/${order.code}`;
  sendOrderEmail(order, { restaurant: RESTAURANT_NAME, statusUrl });
}

// ---------- Kitchen password (HTTP Basic Auth, any username) ----------
function kitchenAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const password = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(password);
    const b = Buffer.from(KITCHEN_PASSWORD);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Kitchen"').status(401).send('Kitchen password required');
}

// ---------- Pages ----------
const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
app.get('/', page('index.html'));
app.get('/order/:code', page('order.html'));
app.get('/kitchen', kitchenAuth, page('kitchen.html'));
app.get('/kitchen/menu', kitchenAuth, page('menu-admin.html'));
app.use('/static', express.static(path.join(__dirname, 'public')));

// ---------- Public API ----------
app.get('/api/info', (req, res) => res.json({ name: RESTAURANT_NAME }));

app.get('/api/menu', ah(async (req, res) => {
  res.json(await db.all(`SELECT * FROM menu_items
    ORDER BY (SELECT MIN(id) FROM menu_items m2 WHERE m2.category = menu_items.category), name`));
}));

app.post('/api/orders', ah(async (req, res) => {
  const { name, email, fulfilment, address, requestedTime, items } = req.body || {};

  if (!name?.trim()) return res.status(400).json({ error: 'Please enter your name.' });
  const mail = String(email || '').trim();
  if (!mail) return res.status(400).json({ error: 'Please enter your email address.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'Please check your email address.' });
  if (!['pickup', 'delivery'].includes(fulfilment)) return res.status(400).json({ error: 'Choose pickup or delivery.' });
  if (fulfilment === 'delivery' && !address?.trim()) return res.status(400).json({ error: 'Address is required for delivery.' });

  const when = new Date(requestedTime);
  if (isNaN(when)) return res.status(400).json({ error: 'Choose a valid time.' });
  if (when < Date.now() - 5 * 60 * 1000) return res.status(400).json({ error: 'The chosen time is in the past.' });

  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  // Look up prices on the server so the client can't change them.
  const lines = [];
  for (const { id, qty } of items) {
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid item in cart.' });
    const item = await db.get('SELECT * FROM menu_items WHERE id = ?', [id]);
    const n = Number(qty);
    if (!item || !Number.isInteger(n) || n < 1 || n > 50) return res.status(400).json({ error: 'Invalid item in cart.' });
    if (item.sold_out) return res.status(400).json({ error: `Sorry, ${item.name} is sold out.` });
    lines.push({ name: item.name, price: item.price, qty: n });
  }
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const code = crypto.randomBytes(6).toString('hex');

  await db.run(`INSERT INTO orders (code, status, customer_name, phone, email, fulfilment, address, requested_time, items, total)
              VALUES (?, 'Received', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, name.trim(), '', mail, fulfilment, fulfilment === 'delivery' ? address.trim() : '',
         when.toISOString(), JSON.stringify(lines), total]);

  res.status(201).json({ code });
  emailCustomer(req, 'code', code).catch((err) => console.error(err));
}));

app.get('/api/orders/:code', ah(async (req, res) => {
  const o = await db.get('SELECT * FROM orders WHERE code = ?', [req.params.code]);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json({
    id: o.id, status: o.status, fulfilment: o.fulfilment,
    requestedTime: o.requested_time, items: JSON.parse(o.items), total: o.total,
    restaurant: RESTAURANT_NAME,
  });
}));

// ---------- Kitchen API ----------
app.use('/kitchen/api', kitchenAuth);

// ?view=received (default, oldest time first) | ready | cancelled (newest first)
app.get('/kitchen/api/orders', ah(async (req, res) => {
  const views = {
    received: ['Received', 'ASC'],
    ready: ['Ready', 'DESC LIMIT 50'],
    cancelled: ['Cancelled', 'DESC LIMIT 50'],
  };
  const [status, order] = views[req.query.view] || views.received;
  const rows = await db.all(`SELECT * FROM orders WHERE status = ? ORDER BY requested_time ${order}`, [status]);
  res.json(rows.map((o) => ({ ...o, items: JSON.parse(o.items) })));
}));

app.patch('/kitchen/api/orders/:id', ah(async (req, res) => {
  const { status } = req.body || {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const result = await db.run('UPDATE orders SET status = ? WHERE id = ? AND status != ?', [status, req.params.id, status]);
    if (result.rowsAffected) emailCustomer(req, 'id', req.params.id).catch((err) => console.error(err));
  }
  res.json({ ok: true });
}));

function readMenuItem(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  if (!name) return { error: 'Name is required.' };
  if (!Number.isInteger(price) || price < 0) return { error: 'Price must be a whole number of kronor.' };
  return {
    name, price,
    description: String(body.description || '').trim(),
    category: String(body.category || '').trim() || 'Other',
    sold_out: body.sold_out ? 1 : 0,
  };
}

app.post('/kitchen/api/menu', ah(async (req, res) => {
  const m = readMenuItem(req.body || {});
  if (m.error) return res.status(400).json(m);
  await db.run('INSERT INTO menu_items (name, description, price, category, sold_out) VALUES (?, ?, ?, ?, ?)',
    [m.name, m.description, m.price, m.category, m.sold_out]);
  res.status(201).json({ ok: true });
}));

app.put('/kitchen/api/menu/:id', ah(async (req, res) => {
  const m = readMenuItem(req.body || {});
  if (m.error) return res.status(400).json(m);
  await db.run('UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, sold_out = ? WHERE id = ?',
    [m.name, m.description, m.price, m.category, m.sold_out, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/kitchen/api/menu/:id', ah(async (req, res) => {
  await db.run('DELETE FROM menu_items WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

db.ready.then(() => {
  app.listen(PORT, () => console.log(`${RESTAURANT_NAME} running on http://localhost:${PORT}`));
}).catch((err) => {
  console.error('Could not open the database:', err.message);
  process.exit(1);
});
