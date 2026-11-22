const { createClient } = require('@libsql/client');
const path = require('path');

// Online: set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN.
// Locally: a plain SQLite file (restaurant.db, or DB_PATH).
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + (process.env.DB_PATH || path.join(__dirname, 'restaurant.db')),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Turn result rows into plain objects.
function toObjects(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])));
}

const db = {
  all: async (sql, args = []) => toObjects(await client.execute({ sql, args })),
  get: async (sql, args = []) => (await db.all(sql, args))[0],
  run: (sql, args = []) => client.execute({ sql, args }),
};

async function setup() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      price       INTEGER NOT NULL,          -- whole kronor
      category    TEXT    NOT NULL DEFAULT 'Other',
      sold_out    INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT    NOT NULL UNIQUE, -- random, used in the customer's status link
      customer_name  TEXT    NOT NULL,
      phone          TEXT    NOT NULL,
      email          TEXT    NOT NULL DEFAULT '',
      fulfilment     TEXT    NOT NULL,        -- 'pickup' | 'delivery'
      address        TEXT    NOT NULL DEFAULT '',
      requested_time TEXT    NOT NULL,        -- ISO timestamp
      items          TEXT    NOT NULL,        -- JSON: [{name, price, qty}]
      total          INTEGER NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'Received', -- Received | Ready | Cancelled
      paid           INTEGER NOT NULL DEFAULT 0,  -- no longer used
      created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
  ], 'write');

  // Databases created before the email field existed: add the column.
  const cols = await db.all('PRAGMA table_info(orders)');
  if (!cols.some((c) => c.name === 'email')) {
    await client.execute("ALTER TABLE orders ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }

  // Orders from before the statuses were simplified to Received / Ready / Cancelled.
  await client.batch([
    "UPDATE orders SET status = 'Received' WHERE status IN ('New', 'Accepted', 'Cooking')",
    "UPDATE orders SET status = 'Ready' WHERE status = 'Done'",
    "UPDATE orders SET status = 'Cancelled' WHERE status = 'Rejected'",
  ], 'write');
}
db.ready = setup();

module.exports = db;
