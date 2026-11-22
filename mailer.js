// Order emails to customers, sent with Brevo's email API.
// (Render's free plan blocks normal SMTP, so we use HTTPS instead.)
// If BREVO_API_KEY or MAIL_FROM is not set, emails are skipped.

const BREVO_URL = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
const API_KEY = process.env.BREVO_API_KEY;
const FROM = process.env.MAIL_FROM; // must be a sender verified in Brevo
const TIMEZONE = process.env.TIMEZONE || 'Europe/Stockholm';

if (!API_KEY || !FROM) console.warn('Email is off: set BREVO_API_KEY and MAIL_FROM to send order emails.');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB', {
  timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

// Which statuses send an email, and what they say.
function message(order) {
  const when = fmtTime(order.requested_time);
  const pickup = order.fulfilment === 'pickup';
  switch (order.status) {
    case 'Received':
      return {
        subject: `We received your order #${order.id}`,
        intro: `Thank you for your order! We will have it ready for ${pickup ? 'pickup' : 'delivery'} on ${when}.`,
      };
    case 'Cancelled':
      return {
        subject: `Your order #${order.id} is cancelled`,
        intro: `Unfortunately we had to cancel your order. If you already paid, we will refund you. Sorry for the trouble!`,
      };
    case 'Ready':
      return {
        subject: `Your order #${order.id} is ready`,
        intro: pickup ? `Your food is ready for pickup. See you soon!` : `Your food is ready and will be on its way to you shortly.`,
      };
    default:
      return null; // no email for other statuses
  }
}

async function sendOrderEmail(order, { restaurant, statusUrl }) {
  if (!API_KEY || !FROM || !order.email) return;
  const msg = message(order);
  if (!msg) return;

  const items = JSON.parse(order.items);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2d2520">
      <h2 style="color:#c0562b;margin-bottom:4px">${esc(restaurant)}</h2>
      <p>Hi ${esc(order.customer_name)},</p>
      <p>${msg.intro}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        ${items.map((i) => `<tr><td style="padding:4px 0">${i.qty} × ${esc(i.name)}</td><td style="text-align:right">${i.qty * i.price} kr</td></tr>`).join('')}
        <tr><td style="padding-top:8px;border-top:1px solid #ddd"><b>Total</b></td><td style="text-align:right;padding-top:8px;border-top:1px solid #ddd"><b>${order.total} kr</b></td></tr>
      </table>
      <p>${order.fulfilment === 'pickup' ? 'Pickup' : 'Delivery to ' + esc(order.address)} · ${fmtTime(order.requested_time)}</p>
      <p><a href="${esc(statusUrl)}" style="display:inline-block;background:#c0562b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Follow your order</a></p>
      <p style="font-size:13px;color:#555">Or open this link: <a href="${esc(statusUrl)}" style="color:#c0562b">${esc(statusUrl)}</a></p>
      <p style="color:#888;font-size:12px">Order #${order.id}</p>
    </div>`;

  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: FROM, name: restaurant },
        to: [{ email: order.email, name: order.customer_name }],
        subject: `${msg.subject} – ${restaurant}`,
        htmlContent: html,
      }),
    });
    if (!res.ok) console.error(`Email for order #${order.id} failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`Email for order #${order.id} failed: ${err.message}`);
  }
}

module.exports = { sendOrderEmail };
