const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'restaurant.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    price       INTEGER NOT NULL,          -- whole kronor
    category    TEXT    NOT NULL DEFAULT 'Other',
    sold_out    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT    NOT NULL UNIQUE, -- random, used in the customer's status link
    customer_name  TEXT    NOT NULL,
    phone          TEXT    NOT NULL,
    fulfilment     TEXT    NOT NULL,        -- 'pickup' | 'delivery'
    address        TEXT    NOT NULL DEFAULT '',
    requested_time TEXT    NOT NULL,        -- ISO timestamp
    items          TEXT    NOT NULL,        -- JSON: [{name, price, qty}]
    total          INTEGER NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'New',
    paid           INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

module.exports = db;
