const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const KITCHEN_PASSWORD = process.env.KITCHEN_PASSWORD || 'kitchen';
const SWISH_NUMBER = process.env.SWISH_NUMBER || '123 456 78 90';
const RESTAURANT_NAME = process.env.RESTAURANT_NAME || 'KC Home Restaurant';

const STATUSES = ['New', 'Accepted', 'Cooking', 'Ready', 'Done', 'Rejected', 'Cancelled'];
const FINISHED = ['Done', 'Rejected', 'Cancelled'];

if (!process.env.KITCHEN_PASSWORD) {
  console.warn('WARNING: KITCHEN_PASSWORD not set, using default "kitchen".');
}

const app = express();
app.use(express.json());

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

app.get('/api/menu', (req, res) => {
  res.json(db.prepare(`SELECT * FROM menu_items
    ORDER BY (SELECT MIN(id) FROM menu_items m2 WHERE m2.category = menu_items.category), name`).all());
});

app.post('/api/orders', (req, res) => {
  const { name, phone, fulfilment, address, requestedTime, items } = req.body || {};

  if (!name?.trim() || !phone?.trim()) return res.status(400).json({ error: 'Name and phone are required.' });
  if (!['pickup', 'delivery'].includes(fulfilment)) return res.status(400).json({ error: 'Choose pickup or delivery.' });
  if (fulfilment === 'delivery' && !address?.trim()) return res.status(400).json({ error: 'Address is required for delivery.' });

  const when = new Date(requestedTime);
  if (isNaN(when)) return res.status(400).json({ error: 'Choose a valid time.' });
  if (when < Date.now() - 5 * 60 * 1000) return res.status(400).json({ error: 'The chosen time is in the past.' });

  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  // Look up prices on the server so the client can't change them.
  const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ?');
  const lines = [];
  for (const { id, qty } of items) {
    const item = getItem.get(id);
    const n = Number(qty);
    if (!item || !Number.isInteger(n) || n < 1 || n > 50) return res.status(400).json({ error: 'Invalid item in cart.' });
    if (item.sold_out) return res.status(400).json({ error: `Sorry, ${item.name} is sold out.` });
    lines.push({ name: item.name, price: item.price, qty: n });
  }
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const code = crypto.randomBytes(6).toString('hex');

  db.prepare(`INSERT INTO orders (code, customer_name, phone, fulfilment, address, requested_time, items, total)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name.trim(), phone.trim(), fulfilment, fulfilment === 'delivery' ? address.trim() : '',
         when.toISOString(), JSON.stringify(lines), total);

  res.status(201).json({ code });
});

app.get('/api/orders/:code', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(req.params.code);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  res.json({
    id: o.id, status: o.status, paid: !!o.paid, fulfilment: o.fulfilment,
    requestedTime: o.requested_time, items: JSON.parse(o.items), total: o.total,
    swishNumber: SWISH_NUMBER, restaurant: RESTAURANT_NAME,
  });
});

// ---------- Kitchen API ----------
app.use('/kitchen/api', kitchenAuth);

// ?view=active (default) | finished (Done) | rejected (Rejected + Cancelled)
app.get('/kitchen/api/orders', (req, res) => {
  const views = {
    active: [`status NOT IN (${FINISHED.map(() => '?').join(',')})`, FINISHED, 'ASC'],
    finished: ["status = 'Done'", [], 'DESC LIMIT 50'],
    rejected: ["status IN ('Rejected', 'Cancelled')", [], 'DESC LIMIT 50'],
  };
  const [where, params, order] = views[req.query.view] || views.active;
  const rows = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY requested_time ${order}`).all(...params);
  res.json(rows.map((o) => ({ ...o, paid: !!o.paid, items: JSON.parse(o.items) })));
});

app.patch('/kitchen/api/orders/:id', (req, res) => {
  const { status, paid } = req.body || {};
  if (status !== undefined) {
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  }
  if (paid !== undefined) db.prepare('UPDATE orders SET paid = ? WHERE id = ?').run(paid ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

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

app.post('/kitchen/api/menu', (req, res) => {
  const m = readMenuItem(req.body || {});
  if (m.error) return res.status(400).json(m);
  db.prepare('INSERT INTO menu_items (name, description, price, category, sold_out) VALUES (?, ?, ?, ?, ?)')
    .run(m.name, m.description, m.price, m.category, m.sold_out);
  res.status(201).json({ ok: true });
});

app.put('/kitchen/api/menu/:id', (req, res) => {
  const m = readMenuItem(req.body || {});
  if (m.error) return res.status(400).json(m);
  db.prepare('UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, sold_out = ? WHERE id = ?')
    .run(m.name, m.description, m.price, m.category, m.sold_out, req.params.id);
  res.json({ ok: true });
});

app.delete('/kitchen/api/menu/:id', (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`${RESTAURANT_NAME} running on http://localhost:${PORT}`));
