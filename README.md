# KC Home Restaurant

A small online ordering app for a home restaurant.

| Page | Who | What |
|---|---|---|
| `/` | Customers | Menu by category, cart, checkout (name, phone, pickup/delivery, time) |
| `/order/<code>` | Customers | Live order status + Swish payment info (auto-refreshes) |
| `/kitchen` | Kitchen (password) | Tabs for Received / Ready / Cancelled orders, sound on new orders |
| `/kitchen/menu` | Kitchen (password) | Add / edit / delete dishes, mark sold out |

Order statuses: **Received → Ready**, or **Cancelled**.

## Run it

Needs Node.js 20 or newer. Locally the data is kept in a `restaurant.db` file (nothing to install).

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
| `DB_PATH` | `./restaurant.db` | Local database file (used when `TURSO_DATABASE_URL` is not set) |
| `TURSO_DATABASE_URL` | (none) | Online database, e.g. `libsql://kchomerestaurant-yourname.turso.io` |
| `TURSO_AUTH_TOKEN` | (none) | Token for the online database |
| `BREVO_API_KEY` | (none) | Brevo API key for order emails (emails are off without it) |
| `MAIL_FROM` | (none) | Sender address, must be verified in Brevo |
| `TIMEZONE` | `Europe/Stockholm` | Time zone used for times in emails |

## Put it online for free (Render + Turso)

Render runs the app; Turso stores the menu and orders (Render's free plan deletes local files on restart).

### 1. Create the database (Turso)
1. Sign up at https://turso.tech (free plan, log in with GitHub).
2. Create a database, e.g. `kchomerestaurant`. Pick a location close to you (e.g. Europe).
3. On the database page, copy the **URL** (starts with `libsql://`).
4. Create a **token** for the database (read & write) and copy it. Keep it secret.

### 2. Create the web app (Render)
1. Sign up at https://render.com (free, log in with GitHub).
2. **New → Web Service** → connect GitHub and choose the `kchomerestaurant` repository.
3. Settings:
   - **Branch:** the branch with this code
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under **Environment Variables** add:
   - `TURSO_DATABASE_URL` = the URL from Turso
   - `TURSO_AUTH_TOKEN` = the token from Turso
   - `KITCHEN_PASSWORD` = your kitchen password
   - `SWISH_NUMBER` = your Swish number
   - `RESTAURANT_NAME` = your restaurant's name
5. Click **Create Web Service**. After a few minutes you get a link like `https://kchomerestaurant.onrender.com`.
6. Open `/kitchen/menu` on that link and add your dishes. Share the main link with customers.

Every time new code is pushed to that branch, Render updates the site automatically.

**Free plan note:** after 15 minutes without visitors the app sleeps, and the next visitor waits up to about a minute.
Keep the kitchen page open while you take orders, which keeps the app awake.

## Order emails (Brevo, free)

Customers can enter an email address at checkout (optional). They get an email when the order is
**received** (with the Swish details), **ready**, or **cancelled**.

1. Sign up at https://www.brevo.com (free plan: 300 emails per day).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: add the email address you want to send from
   (e.g. your Gmail) and confirm it with the code Brevo emails you.
3. **SMTP & API → API keys → Generate a new API key**. Copy it (keep it secret).
4. In Render → your service → **Environment**, add:
   - `BREVO_API_KEY` = the API key
   - `MAIL_FROM` = the sender address from step 2
5. Save. Render restarts the app. Place a test order with your own email address.

Without your own domain, some emails may end up in the customer's spam folder.

## Notes

- **Sound:** browsers only play sound after you click something on the page, so press **Enable sound** once when you open the kitchen page.
- **Backups:** locally, everything is in `restaurant.db`; online, it is in your Turso database.
- **HTTPS:** always use the https:// link online, since the kitchen password is sent with each request (Render provides HTTPS).
