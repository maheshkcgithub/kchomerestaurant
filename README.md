# KC Home Restaurant

A small online ordering app for a home restaurant.

| Page | Who | What |
|---|---|---|
| `/` | Customers | Menu by category, cart, checkout (name, phone, pickup/delivery, time) |
| `/order/<code>` | Customers | Live order status + Swish payment info (auto-refreshes) |
| `/kitchen` | Kitchen (password) | Active orders sorted by requested time, status buttons, Paid checkbox, sound on new orders |
| `/kitchen/menu` | Kitchen (password) | Add / edit / delete dishes, mark sold out |

Order statuses: **New → Accepted → Cooking → Ready → Done** (or Rejected / Cancelled).

## Run it

Needs Node.js 22.13 or newer (uses Node's built-in SQLite, no database to install).

```bash
npm install
KITCHEN_PASSWORD=choose-a-password SWISH_NUMBER="070 123 45 67" npm start
```

Open http://localhost:3000. For the kitchen, open http://localhost:3000/kitchen. The browser asks for a username and password: type anything as the username and your `KITCHEN_PASSWORD` as the password.

Start by adding dishes under **Edit menu**.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `KITCHEN_PASSWORD` | `kitchen` | Password for the kitchen pages, **change it** |
| `SWISH_NUMBER` | `123 456 78 90` | Shown to customers after ordering |
| `RESTAURANT_NAME` | `KC Home Restaurant` | Page title |
| `PORT` | `3000` | Web server port |
| `DB_PATH` | `./restaurant.db` | SQLite file with menu and orders |

## Notes

- **Sound:** browsers only play sound after you click something on the page, so press **Enable sound** once when you open the kitchen page.
- **Backups:** everything is stored in `restaurant.db`. Copy that file to back up.
- **Hosting:** any host that runs Node 22 works. Make sure `restaurant.db` is on a persistent disk (set `DB_PATH`), and serve it over HTTPS, since the kitchen password is sent with each request.
