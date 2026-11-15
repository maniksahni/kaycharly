// Kay Charly · Cloudflare Worker: the whole site on one free Cloudflare account.
//   • Static files (index.html, admin.html, …) are served from the repository root (assets).
//   • /rest/v1/…, /auth/v1/…, /functions/v1/…, /storage/v1/…: the API the pages call, backed by D1 (database)
//     and KV (menu photos).
//   • Every 10 minutes (cron): "Comment était votre repas ?" emails and the unprinted-order alert.
//
// Bindings (wrangler.jsonc): DB (D1), PHOTOS (KV), ASSETS.
// Secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
//   ADMIN_PASSWORD (admin login) · BREVO_API_KEY (emails) · SHEET_TOKEN (Google Sheet, optional)
// Vars: SITE_ORIGIN (links in emails, https://kaycharly.fr), OWNER_EMAIL, SENDER_EMAIL.

import {
  sendEmail, ownerEmail, customerOrderEmail, ownerOrderEmail, feedbackEmail, menuEmail, printAlertEmail,
  feedbackDue, parisDate, isDelivery,
} from './mail.js';
import { SCHEMA } from './schema.js';

const now = () => new Date().toISOString();
const STATUSES = ['Nouvelle', 'En préparation', 'Prête', 'Retirée', 'Annulée'];
const ADMIN_EMAIL = 'admin@kaycharly.example';   // the admin page logs in with this fixed address + the password

// ---------- responses ----------
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
const json = (body, status = 200, extra = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY, ...extra },
});
// Errors carry both `message` (read by the pages) and `error`.
const fail = (message, status = 400, extra = {}) => json({ message, error: message, ...extra }, status);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const deny = (status, message) => { throw new HttpError(status, message); };

// ---------- auth: one admin password, signed tokens ----------
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function hmacKey(env) {
  // Derived from the admin password: changing the password signs everyone out.
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('kay-charly-session:' + (env.ADMIN_PASSWORD || '')));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signToken(env, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return body + '.' + b64url(sig);
}
async function readToken(env, token, type) {
  if (!env.ADMIN_PASSWORD || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return p.t === type && p.exp * 1000 > Date.now() ? p : null;
  } catch { return null; }
}
const ACCESS_SECONDS = 3600, REFRESH_SECONDS = 400 * 86400;   // the phone stays logged in for a year+
async function newSession(env) {
  const t = Math.floor(Date.now() / 1000);
  return {
    access_token: await signToken(env, { t: 'a', sub: 'admin', exp: t + ACCESS_SECONDS }),
    refresh_token: await signToken(env, { t: 'r', sub: 'admin', exp: t + REFRESH_SECONDS, n: crypto.randomUUID() }),
    token_type: 'bearer', expires_in: ACCESS_SECONDS, expires_at: t + ACCESS_SECONDS,
    user: { id: 'admin', email: ADMIN_EMAIL },
  };
}
async function isAdmin(env, req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!(await readToken(env, token, 'a'));
}
const requireAdmin = async (env, req) => { if (!(await isAdmin(env, req))) deny(401, 'Session expirée : reconnectez-vous.'); };

function sameText(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function auth(env, req, url) {
  const path = url.pathname.replace(/^\/auth\/v1\//, '');
  if (path === 'logout') return json(undefined, 204);
  if (path !== 'token' || req.method !== 'POST') deny(404, 'Introuvable');
  const body = await req.json().catch(() => ({}));
  const grant = url.searchParams.get('grant_type');
  if (grant === 'refresh_token') {
    if (!(await readToken(env, body.refresh_token, 'r'))) deny(400, 'Session expirée : reconnectez-vous.');
    return json(await newSession(env));
  }
  if (grant !== 'password') deny(400, 'Requête invalide');
  if (!env.ADMIN_PASSWORD) deny(503, 'Mot de passe administrateur non configuré.');
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const { n } = await env.DB.prepare('SELECT count(*) AS n FROM kc_login_attempts WHERE ip = ? AND at > ?').bind(ip, since).first();
  if (n >= 10) deny(429, 'Trop d’essais. Réessayez dans 15 minutes.');
  if (!sameText(String(body.password || ''), env.ADMIN_PASSWORD)) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO kc_login_attempts (ip, at) VALUES (?, ?)').bind(ip, now()),
      env.DB.prepare('DELETE FROM kc_login_attempts WHERE at < ?').bind(new Date(Date.now() - 86400000).toISOString()),
    ]);
    deny(400, 'Mot de passe incorrect.');
  }
  return json(await newSession(env));
}

// ---------- rows in/out (same shape as the former database) ----------
const parse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
const outMenu = (r) => ({ ...r, available: !!r.available, featured: !!r.featured });
const outOrder = (r) => ({ ...r, items: parse(r.items, []) });
const outStatus = (r) => ({ ...r, ready: !!r.ready, steps: parse(r.steps, []), diag: parse(r.diag, {}) });

// Small query reader for the GET requests the pages make: select, order, limit and col=op.value filters.
const TABLES = {
  kc_menu: { cols: ['id', 'name', 'description', 'category', 'price', 'photo', 'available', 'featured', 'sort_order', 'updated_at'], out: outMenu, public: true },
  kc_orders: { cols: ['id', 'reference', 'created_at', 'customer_name', 'customer_email', 'phone', 'address', 'note', 'pickup', 'items', 'total', 'status', 'request_id', 'archived_at', 'feedback_sent_at', 'feedback_token'], out: outOrder, where: 'archived_at IS NULL' },
  kc_feedback: { cols: ['order_reference', 'rating', 'comment', 'created_at', 'updated_at'], out: (r) => r },
  kc_printer_status: { cols: ['device_id', 'device_name', 'platform', 'mode', 'printer_name', 'ready', 'stuck_step', 'stuck_label', 'steps', 'last_print_ref', 'last_print_at', 'last_error', 'diag', 'updated_at'], out: outStatus },
  kc_printer_events: { cols: ['id', 'device_id', 'event', 'detail', 'created_at'], out: (r) => r },
};
const OPS = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
function readQuery(table, params) {
  const t = TABLES[table];
  const sel = (params.get('select') || '*').split(',').map((c) => c.trim());
  const cols = sel.includes('*') ? t.cols : sel.filter((c) => t.cols.includes(c));
  if (!cols.length) deny(400, 'Colonnes invalides');
  const where = t.where ? [t.where] : [], args = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (!t.cols.includes(k)) deny(400, 'Filtre invalide');
    const m = /^(eq|neq|gt|gte|lt|lte|is)\.(.*)$/s.exec(v);
    if (!m) deny(400, 'Filtre invalide');
    if (m[1] === 'is') { where.push(`${k} IS ${m[2] === 'null' ? '' : 'NOT '}NULL`); continue; }
    where.push(`${k} ${OPS[m[1]]} ?`); args.push(m[2]);
  }
  let order = '';
  const o = /^([a-z_]+)\.(asc|desc)$/.exec(params.get('order') || '');
  if (o && t.cols.includes(o[1])) order = ` ORDER BY ${o[1]} ${o[2].toUpperCase()}`;
  const limit = Math.min(1000, Math.max(1, Number(params.get('limit')) || 1000));
  return { sql: `SELECT ${cols.join(', ')} FROM ${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''}${order} LIMIT ${limit}`, args, out: t.out };
}
const filterId = (params, col) => { const v = /^eq\.(.+)$/s.exec(params.get(col) || ''); if (!v) deny(400, 'Ligne non précisée'); return v[1]; };

// ---------- /rest/v1 ----------
async function rest(env, req, url) {
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  if (path.startsWith('rpc/')) return rpc(env, req, path.slice(4));
  const table = path;
  if (!TABLES[table]) deny(404, 'Introuvable');
  const p = url.searchParams;
  if (req.method === 'GET') {
    if (!TABLES[table].public) await requireAdmin(env, req);
    const q = readQuery(table, p);
    const { results } = await env.DB.prepare(q.sql).bind(...q.args).all();
    return json(results.map(q.out));
  }
  await requireAdmin(env, req);
  const body = req.method === 'DELETE' ? null : await req.json().catch(() => deny(400, 'Requête invalide'));

  if (table === 'kc_menu') {
    if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM kc_menu WHERE id = ?').bind(filterId(p, 'id')).run(); return json(undefined, 204); }
    if (req.method === 'PATCH') {
      const id = filterId(p, 'id'), set = [], args = [];
      for (const k of ['name', 'description', 'category', 'price', 'photo', 'available', 'featured', 'sort_order']) if (k in body) { set.push(`${k} = ?`); args.push(menuValue(k, body[k])); }
      if (!set.length) deny(400, 'Rien à modifier');
      await env.DB.prepare(`UPDATE kc_menu SET ${set.join(', ')}, updated_at = ? WHERE id = ?`).bind(...args, now(), id).run();
      return json(undefined, 204);
    }
    if (req.method === 'POST') {   // upsert one dish (or several)
      const rows = Array.isArray(body) ? body : [body];
      await env.DB.batch(rows.map((d) => {
        const id = String(d.id || '').trim().slice(0, 80) || deny(400, 'Identifiant manquant');
        const v = ['name', 'description', 'category', 'price', 'photo', 'available', 'featured', 'sort_order'].map((k) => menuValue(k, d[k]));
        return env.DB.prepare(`INSERT INTO kc_menu (id, name, description, category, price, photo, available, featured, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, category = excluded.category, price = excluded.price, photo = excluded.photo,
          available = excluded.available, featured = excluded.featured, sort_order = excluded.sort_order, updated_at = excluded.updated_at`).bind(id, ...v, now());
      }));
      return json(undefined, 201);
    }
  }
  if (table === 'kc_orders' && req.method === 'PATCH') {
    if (!STATUSES.includes(body.status) || Object.keys(body).some((k) => k !== 'status')) deny(400, 'Statut invalide');
    await env.DB.prepare('UPDATE kc_orders SET status = ? WHERE id = ? AND archived_at IS NULL').bind(body.status, filterId(p, 'id')).run();
    return json(undefined, 204);
  }
  if (table === 'kc_printer_status' && req.method === 'POST') {
    const s = body || {};
    const id = String(s.device_id || '');
    if (id.length < 8 || id.length > 64) deny(400, 'Appareil invalide');
    const str = (v, n) => String(v ?? '').slice(0, n);
    await env.DB.prepare(`INSERT INTO kc_printer_status (device_id, device_name, platform, mode, printer_name, ready, stuck_step, stuck_label, steps, last_print_ref, last_print_at, last_error, diag, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name, platform = excluded.platform, mode = excluded.mode, printer_name = excluded.printer_name,
      ready = excluded.ready, stuck_step = excluded.stuck_step, stuck_label = excluded.stuck_label, steps = excluded.steps, last_print_ref = excluded.last_print_ref,
      last_print_at = excluded.last_print_at, last_error = excluded.last_error, diag = excluded.diag, updated_at = excluded.updated_at`)
      .bind(id, str(s.device_name, 60), str(s.platform, 120), ['', 'usb', 'ble', 'serial', 'browser'].includes(s.mode) ? s.mode : '', str(s.printer_name, 120),
        s.ready ? 1 : 0, Number.isInteger(s.stuck_step) ? s.stuck_step : null, str(s.stuck_label, 200), JSON.stringify(s.steps || []).slice(0, 8000),
        str(s.last_print_ref, 20), s.last_print_at || null, str(s.last_error, 300), JSON.stringify(s.diag || {}).slice(0, 4000), now()).run();
    return json(undefined, 201);
  }
  if (table === 'kc_printer_events' && req.method === 'POST') {
    const e = body || {};
    const id = String(e.device_id || ''), ev = String(e.event || '');
    if (id.length < 8 || id.length > 64 || !ev || ev.length > 40) deny(400, 'Événement invalide');
    await env.DB.prepare('INSERT INTO kc_printer_events (device_id, event, detail, created_at) VALUES (?, ?, ?, ?)').bind(id, ev, String(e.detail || '').slice(0, 300), now()).run();
    return json(undefined, 201);
  }
  deny(405, 'Action non autorisée');
}
function menuValue(k, v) {
  if (k === 'price') { const n = Math.round(Number(v) || 0); if (n < 0 || n > 99900) deny(400, 'Prix invalide'); return n; }
  if (k === 'available') return v === false ? 0 : 1;
  if (k === 'featured') return v ? 1 : 0;
  if (k === 'sort_order') return Math.round(Number(v) || 0);
  if (k === 'name') { const s = String(v || '').trim(); if (!s || s.length > 100) deny(400, 'Nom invalide'); return s; }
  if (k === 'category') { const s = String(v || '').trim(); if (!s) deny(400, 'Catégorie manquante'); return s.slice(0, 60); }
  return String(v ?? '').slice(0, k === 'photo' ? 500 : 400);
}

// ---------- /rest/v1/rpc ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^KC-[A-F0-9]{10}$/;
async function rpc(env, req, fn) {
  if (req.method !== 'POST') deny(405, 'Méthode non autorisée');
  const b = await req.json().catch(() => ({}));
  const DB = env.DB;
  switch (fn) {
    case 'kc_is_admin':
      return json(await isAdmin(env, req));

    case 'kc_place_order_with_email': {
      const name = String(b.p_name || '').trim(), email = String(b.p_email || '').trim().toLowerCase(), phone = String(b.p_phone || '');
      const address = String(b.p_address || ''), note = String(b.p_note || ''), pickup = String(b.p_pickup || ''), requestId = String(b.p_request_id || '');
      if (!UUID.test(requestId) || name.length < 2 || name.length > 60 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254
        || !/^0[1-9][0-9]{8}$/.test(phone) || address.length > 160 || note.length > 300 || pickup.length < 1 || pickup.length > 100) deny(400, 'Informations de commande invalides');
      const previous = await DB.prepare('SELECT reference, total FROM kc_orders WHERE request_id = ?').bind(requestId).first();
      if (previous) return json(previous);   // same click sent twice: same order
      const recent = await DB.prepare('SELECT count(*) AS n FROM kc_orders WHERE phone = ? AND created_at > ?').bind(phone, new Date(Date.now() - 5 * 60000).toISOString()).first();
      if (recent.n >= 3) deny(400, 'Veuillez patienter avant une nouvelle commande');
      const items = b.p_items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 30) deny(400, 'Panier invalide');
      const ids = items.map((i) => String(i?.id || ''));
      const { results: dishes } = await DB.prepare(`SELECT id, name, price, available FROM kc_menu WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      const byId = Object.fromEntries(dishes.map((d) => [d.id, d]));
      let amount = 0; const snapshot = [];
      for (const it of items) {
        const q = Number(it.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 20) deny(400, 'Quantité invalide');
        const d = byId[String(it.id)];
        if (!d || !d.available || d.price <= 0) deny(400, 'Un plat est indisponible, actualisez votre panier');
        amount += d.price * q;
        snapshot.push({ id: d.id, name: d.name, quantity: q, price: d.price });
      }
      if (amount > 100000) deny(400, 'Pour une grande commande, appelez la boutique');
      const reference = 'KC-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
      try {
        await DB.prepare(`INSERT INTO kc_orders (id, reference, created_at, customer_name, customer_email, phone, address, note, pickup, items, total, status, request_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Nouvelle', ?)`).bind(crypto.randomUUID(), reference, now(), name, email, phone, address, note, pickup, JSON.stringify(snapshot), amount, requestId).run();
      } catch (e) {
        const again = await DB.prepare('SELECT reference, total FROM kc_orders WHERE request_id = ?').bind(requestId).first();
        if (again) return json(again);
        throw e;
      }
      return json({ reference, total: amount });
    }

    case 'kc_menu_optout_after_order': {   // checkout box "je ne veux pas recevoir le menu du jour"
      const email = String(b.p_email || '').trim().toLowerCase();
      const o = await DB.prepare('SELECT 1 AS ok FROM kc_orders WHERE reference = ? AND customer_email = ? AND created_at > ?').bind(String(b.p_reference || ''), email, new Date(Date.now() - 30 * 60000).toISOString()).first();
      if (!o) deny(400, 'Commande introuvable');
      await DB.prepare(`INSERT INTO kc_email_prefs (email, token, unsubscribed_at, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET unsubscribed_at = COALESCE(kc_email_prefs.unsubscribed_at, excluded.unsubscribed_at)`).bind(email, crypto.randomUUID(), now(), now()).run();
      return json(true);
    }

    case 'kc_feedback_get': {
      if (!REF.test(String(b.p_reference || '')) || !UUID.test(String(b.p_token || ''))) return json(null);
      const o = await DB.prepare(`SELECT o.customer_name, o.created_at, o.items, f.rating, f.comment FROM kc_orders o LEFT JOIN kc_feedback f ON f.order_reference = o.reference
        WHERE o.reference = ? AND o.feedback_token = ?`).bind(b.p_reference, b.p_token).first();
      if (!o) return json(null);
      return json({ first_name: String(o.customer_name || '').trim().split(' ')[0], created_at: o.created_at,
        items: parse(o.items, []).map((i) => ({ name: i.name, quantity: Number(i.quantity) })), rating: o.rating ?? null, comment: o.comment ?? null });
    }

    case 'kc_feedback_submit': {
      const rating = Number(b.p_rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) deny(400, 'Note invalide');
      if (!REF.test(String(b.p_reference || '')) || !UUID.test(String(b.p_token || ''))) deny(400, 'Lien invalide');
      const o = await DB.prepare('SELECT 1 AS ok FROM kc_orders WHERE reference = ? AND feedback_token = ?').bind(b.p_reference, b.p_token).first();
      if (!o) deny(400, 'Lien invalide');
      const comment = String(b.p_comment || '').trim().slice(0, 1000);
      await DB.prepare(`INSERT INTO kc_feedback (order_reference, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(order_reference) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at`).bind(b.p_reference, rating, comment, now(), now()).run();
      return json(true);
    }

    case 'kc_unsubscribe': {
      if (!UUID.test(String(b.p_token || ''))) deny(400, 'Lien invalide');
      const r = await DB.prepare('SELECT email FROM kc_email_prefs WHERE token = ?').bind(b.p_token).first();
      if (!r) deny(400, 'Lien invalide');
      await DB.prepare('UPDATE kc_email_prefs SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE token = ?').bind(now(), b.p_token).run();
      return json(r.email.slice(0, 2) + '•••@' + r.email.split('@')[1]);
    }

    case 'kc_resubscribe': {
      if (!UUID.test(String(b.p_token || ''))) deny(400, 'Lien invalide');
      const r = await DB.prepare('UPDATE kc_email_prefs SET unsubscribed_at = NULL WHERE token = ?').bind(b.p_token).run();
      if (!r.meta.changes) deny(400, 'Lien invalide');
      return json(true);
    }
  }
  deny(404, 'Introuvable');
}

// ---------- /functions/v1 ----------
const siteOf = (env, url) => (env.SITE_ORIGIN || url.origin).replace(/\/$/, '') + '/';

async function functions(env, req, url) {
  if (req.method !== 'POST') deny(405, 'Méthode non autorisée');
  const name = url.pathname.replace(/^\/functions\/v1\//, '');
  const body = await req.json().catch(() => deny(400, 'Requête invalide'));
  const site = siteOf(env, url);

  if (name === 'order-notifications') {
    const reference = String(body.reference || '').trim();
    if (!REF.test(reference)) deny(400, 'Référence invalide');
    // Only right after the order, and only once: nobody can resend these emails later.
    const row = await env.DB.prepare('SELECT * FROM kc_orders WHERE reference = ?').bind(reference).first();
    if (!row || !row.customer_email) deny(404, 'Commande introuvable');
    if (Date.now() - new Date(row.created_at).getTime() > 30 * 60000) deny(409, 'Commande trop ancienne');
    const claim = await env.DB.prepare('UPDATE kc_orders SET notified_at = ? WHERE reference = ? AND notified_at IS NULL').bind(now(), reference).run();
    if (!claim.meta.changes) return json({ customer_sent: true, owner_sent: true, already: true });
    const o = outOrder(row);
    const [customerSent, ownerSent] = await Promise.all([
      sendEmail(env, o.customer_email, customerOrderEmail(o), { replyTo: ownerEmail(env) }),
      sendEmail(env, ownerEmail(env), ownerOrderEmail(o, site), { replyTo: o.customer_email }),
    ]);
    if (!customerSent && !ownerSent) await env.DB.prepare('UPDATE kc_orders SET notified_at = NULL WHERE reference = ?').bind(reference).run();   // nothing left: may be retried
    if (!customerSent || !ownerSent) return fail('Un e-mail n’a pas pu être envoyé', 502, { customer_sent: customerSent, owner_sent: ownerSent });
    return json({ customer_sent: true, owner_sent: true });
  }

  if (name === 'customer-mailings') {
    if (body.action === 'feedback') return json({ ...(await runFeedback(env, site)), print_alert: await runPrintAlert(env, site).catch((e) => ({ error: String(e) })) });
    if (body.action === 'menu') { await requireAdmin(env, req); return runMenu(env, site, body); }
    if (body.action === 'sheet') return runSheet(env, req, body);
    deny(400, 'Action inconnue');
  }
  deny(404, 'Introuvable');
}

// Customer email → unsubscribe token (creates it the first time).
async function tokensFor(env, emails) {
  const map = new Map();
  if (!emails.length) return map;
  await env.DB.batch(emails.map((e) => env.DB.prepare('INSERT OR IGNORE INTO kc_email_prefs (email, token, created_at) VALUES (?, ?, ?)').bind(e, crypto.randomUUID(), now())));
  for (let i = 0; i < emails.length; i += 90) {
    const part = emails.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT email, token, unsubscribed_at FROM kc_email_prefs WHERE email IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const r of results) map.set(r.email, { token: r.token, unsubscribed: !!r.unsubscribed_at });
  }
  return map;
}
const isTest = (name) => /^\s*test\b/i.test(name || '');

async function runFeedback(env, site) {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { results } = await env.DB.prepare(`SELECT reference, customer_name, customer_email, pickup, items, created_at, status FROM kc_orders
    WHERE feedback_sent_at IS NULL AND archived_at IS NULL AND status != 'Annulée' AND created_at > ? ORDER BY created_at LIMIT 200`).bind(since).all();
  const rows = results.map(outOrder);
  const due = rows.filter((o) => o.customer_email && feedbackDue(o) <= Date.now() && !isTest(o.customer_name)).slice(0, 50);
  if (!due.length) return { checked: rows.length, sent: 0 };
  const prefs = await tokensFor(env, [...new Set(due.map((o) => o.customer_email.toLowerCase()))]);
  let sent = 0, skipped = 0;
  for (const o of due) {
    const token = crypto.randomUUID();
    // Claim the order first, so two runs can never send the same email twice.
    const claim = await env.DB.prepare('UPDATE kc_orders SET feedback_sent_at = ?, feedback_token = ? WHERE reference = ? AND feedback_sent_at IS NULL').bind(now(), token, o.reference).run();
    if (!claim.meta.changes) continue;
    const pref = prefs.get(o.customer_email.toLowerCase());
    if (pref?.unsubscribed) { skipped++; continue; }
    if (await sendEmail(env, o.customer_email, feedbackEmail(o, token, pref?.token || '', site), { unsubscribeUrl: pref ? site + 'desinscription.html?t=' + pref.token : undefined })) sent++;
  }
  return { checked: rows.length, due: due.length, sent, skipped };
}

async function runMenu(env, site, body) {
  const when = body.when === 'aujourdhui' ? 'aujourdhui' : 'demain';
  const last = await env.DB.prepare("SELECT created_at, sent, subject FROM kc_mailings WHERE kind = 'menu' ORDER BY created_at DESC LIMIT 1").first();
  const update = !!last && Date.now() - new Date(last.created_at).getTime() < 18 * 3600000;
  const { results: items } = await env.DB.prepare("SELECT name, description, price, photo FROM kc_menu WHERE category = 'Plats du jour' AND available = 1 ORDER BY sort_order").all();
  const mail = menuEmail(items, site, when, { update, message: body.message });
  if (!mail.count) deny(400, 'Aucun plat du jour disponible : activez des plats du jour avant d’envoyer.');
  const { results: rows } = await env.DB.prepare("SELECT DISTINCT lower(trim(customer_email)) AS email, customer_name FROM kc_orders WHERE status != 'Annulée' AND archived_at IS NULL AND customer_email != ''").all();
  const emails = [...new Set(rows.filter((r) => !isTest(r.customer_name)).map((r) => r.email).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  const prefs = await tokensFor(env, emails);
  const list = emails.filter((e) => !prefs.get(e)?.unsubscribed).map((e) => ({ email: e, token: prefs.get(e)?.token || '' }));
  if (body.preview) return json({ subject: mail.subject, html: mail.body(''), recipients: list.map((r) => r.email), last: last || null, update });
  if (body.test) {
    const ok = await sendEmail(env, ownerEmail(env), { subject: '[TEST] ' + mail.subject, html: mail.body(''), text: mail.text });
    return json({ test: true, to: ownerEmail(env), sent: ok ? 1 : 0 });
  }
  if (last && Date.now() - new Date(last.created_at).getTime() < 2 * 60000 && !body.force) return fail('Ce menu vient d’être envoyé il y a moins de 2 minutes.', 409, { recent: last.created_at });
  let sent = 0, failed = 0;
  for (const r of list) {
    const unsub = `${site}desinscription.html?t=${r.token}`;
    (await sendEmail(env, r.email, { subject: mail.subject, html: mail.body(r.token), text: mail.text + `\n\nNe plus recevoir ces e-mails : ${unsub}` }, { unsubscribeUrl: unsub })) ? sent++ : failed++;
  }
  await env.DB.prepare("INSERT INTO kc_mailings (kind, subject, recipients, sent, failed, created_at) VALUES ('menu', ?, ?, ?, ?, ?)").bind(mail.subject.slice(0, 200), list.length, sent, failed, now()).run();
  return json({ recipients: list.length, sent, failed });
}

// A "Nouvelle" order of the last 3 hours, more than 10 minutes old, never printed → one email to the owner.
const ALERT_DEVICE = 'server-alerts';
async function runPrintAlert(env, site) {
  const phone = await env.DB.prepare("SELECT device_name, mode, updated_at FROM kc_printer_status WHERE mode != '' ORDER BY updated_at DESC LIMIT 1").first();
  if (!phone) return { checked: 0, alerted: 0 };
  const from = new Date(Date.now() - 3 * 3600000).toISOString(), to = new Date(Date.now() - 10 * 60000).toISOString();
  const { results: orders } = await env.DB.prepare("SELECT reference, customer_name, created_at, pickup, total FROM kc_orders WHERE status = 'Nouvelle' AND archived_at IS NULL AND created_at >= ? AND created_at <= ? ORDER BY created_at").bind(from, to).all();
  if (!orders.length) return { checked: 0, alerted: 0 };
  const { results: ev } = await env.DB.prepare("SELECT detail FROM kc_printer_events WHERE created_at >= ? AND event IN ('print_ok', 'unprinted_alert')").bind(from).all();
  const seen = new Set(ev.map((e) => String(e.detail).split(' ')[0]));
  const missing = orders.filter((o) => !seen.has(o.reference));
  if (!missing.length) return { checked: orders.length, alerted: 0 };
  const ok = await sendEmail(env, ownerEmail(env), printAlertEmail(missing, phone, site));
  if (ok) await env.DB.batch(missing.map((o) => env.DB.prepare("INSERT INTO kc_printer_events (device_id, event, detail, created_at) VALUES (?, 'unprinted_alert', ?, ?)").bind(ALERT_DEVICE, o.reference, now())));
  return { checked: orders.length, alerted: ok ? missing.length : 0 };
}

// Orders for the owner's Google Sheet (google-sheet/KayCharly.gs). Needs the x-sheet-token header.
async function runSheet(env, req, body) {
  if (!env.SHEET_TOKEN) deny(503, 'Google Sheet non configuré (secret SHEET_TOKEN manquant)');
  if (!sameText(req.headers.get('x-sheet-token') || '', env.SHEET_TOKEN)) deny(401, 'Accès refusé');
  const days = Math.min(3650, Math.max(1, Number(body.days) || 3650));   // default: everything
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [{ results }, { results: fb }, { results: prefs }] = await Promise.all([
    env.DB.prepare('SELECT reference, created_at, customer_name, phone, customer_email, pickup, address, items, total, status, note, archived_at FROM kc_orders WHERE created_at >= ? ORDER BY created_at DESC LIMIT 20000').bind(since).all(),
    env.DB.prepare('SELECT f.order_reference, f.rating, f.comment, f.created_at, f.updated_at, o.customer_name, o.phone, o.customer_email FROM kc_feedback f LEFT JOIN kc_orders o ON o.reference = f.order_reference ORDER BY f.updated_at DESC').all(),
    env.DB.prepare('SELECT email, unsubscribed_at FROM kc_email_prefs').all(),
  ]);
  const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const orders = results.map((r) => {
    const o = outOrder(r);
    return { reference: o.reference, date: parisDate(o.created_at), time: hhmm(o.created_at),
      client: o.customer_name, phone: o.phone, email: o.customer_email, mode: isDelivery(o) ? 'Livraison' : 'À emporter', address: o.address || '',
      items: (o.items || []).map((i) => `${Number(i.quantity)} × ${i.name}`).join(', '), total: Number(o.total) / 100, status: o.archived_at ? 'Archivée' : o.status, note: o.note || '' };
  });
  // One row per customer (by email, else phone): contact, orders, money spent (cancelled orders excluded), emails.
  const unsub = new Map(prefs.map((p) => [p.email, p.unsubscribed_at]));
  const clients = new Map();
  for (const o of [...orders].reverse()) {
    const key = (o.email || '').toLowerCase() || 'tel:' + o.phone;
    const c = clients.get(key) || { client: o.client, email: o.email, phone: o.phone, address: '', first: o.date, last: o.date, orders: 0, cancelled: 0, spent: 0, delivery: 0, pickup: 0 };
    c.client = o.client; c.phone = o.phone; c.last = o.date; if (o.address) c.address = o.address;
    if (o.status === 'Annulée' || o.status === 'Archivée') c.cancelled++;
    else { c.orders++; c.spent += o.total; o.mode === 'Livraison' ? c.delivery++ : c.pickup++; }
    clients.set(key, c);
  }
  const clientRows = [...clients.values()].map((c) => ({ ...c, spent: Math.round(c.spent * 100) / 100,
    emails: !c.email ? '—' : unsub.get(c.email.toLowerCase()) ? 'Désinscrit' : 'Oui' })).sort((a, b) => (a.last < b.last ? 1 : -1));
  const reviews = fb.map((f) => ({ reference: f.order_reference, date: parisDate(f.updated_at), time: hhmm(f.updated_at), rating: f.rating,
    comment: f.comment || '', client: f.customer_name || '', phone: f.phone || '', email: f.customer_email || '' }));
  return json({ generated_at: now(), orders, clients: clientRows, reviews });
}

// ---------- /storage/v1: menu photos in KV ----------
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function storage(env, req, url) {
  const pub = /^\/storage\/v1\/object\/public\/menu-photos\/([A-Za-z0-9._-]{1,80})$/.exec(url.pathname);
  if (pub && (req.method === 'GET' || req.method === 'HEAD')) {
    const { value, metadata } = await env.PHOTOS.getWithMetadata(pub[1], 'arrayBuffer');
    if (!value) return new Response('Not found', { status: 404 });
    return new Response(req.method === 'HEAD' ? null : value, { headers: { 'Content-Type': metadata?.type || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', ...SECURITY } });
  }
  const up = /^\/storage\/v1\/object\/menu-photos\/([A-Za-z0-9._-]{1,80})$/.exec(url.pathname);
  if (up && req.method === 'POST') {
    await requireAdmin(env, req);
    const type = (req.headers.get('content-type') || '').split(';')[0];
    if (!PHOTO_TYPES[type]) deny(400, 'Photo JPEG, PNG ou WebP, 5 Mo maximum.');
    const data = await req.arrayBuffer();
    if (!data.byteLength || data.byteLength > 5 * 1024 * 1024) deny(400, 'Photo JPEG, PNG ou WebP, 5 Mo maximum.');
    await env.PHOTOS.put(up[1], data, { metadata: { type } });
    return json({ Key: 'menu-photos/' + up[1] }, 200);
  }
  deny(404, 'Introuvable');
}

// Tables are created on first use (CREATE … IF NOT EXISTS), once per Worker instance.
let schemaReady = null;
function ensureSchema(env) {
  schemaReady ||= env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------- entry points ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Same-origin pages only (no other website may call the API from a browser).
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    // One address for everyone (phone permissions and logins are per address): www and workers.dev → kaycharly.fr.
    if ((url.hostname === 'www.kaycharly.fr' || url.hostname.endsWith('.workers.dev')) && req.method === 'GET' && !/^\/(rest|auth|functions|storage)\/v1\//.test(url.pathname)) {
      return Response.redirect('https://kaycharly.fr' + url.pathname + url.search, 301);
    }
    try {
      if (/^\/(rest|auth|functions|storage)\/v1\//.test(url.pathname)) {
        await ensureSchema(env);
        if (origin && origin !== url.origin && req.method !== 'GET') deny(403, 'Origine non autorisée');
        if (url.pathname.startsWith('/rest/v1/')) return await rest(env, req, url);
        if (url.pathname.startsWith('/auth/v1/')) return await auth(env, req, url);
        if (url.pathname.startsWith('/functions/v1/')) return await functions(env, req, url);
        return await storage(env, req, url);
      }
      // Static pages: never serve the server's own files.
      if (/^\/(worker|google-sheet|_test)\//.test(url.pathname) || /^\/(wrangler\.jsonc|README\.md|\.assetsignore)$/.test(url.pathname)) return new Response('Not found', { status: 404 });
      if (/^\/\./.test(url.pathname)) return new Response('Not found', { status: 404 });   // .dev.vars, .git…
      if (url.pathname.endsWith('/')) return env.ASSETS.fetch(new Request(new URL(url.pathname + 'index.html', url), req));
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error('Kay Charly API error', url.pathname, String(e && e.stack || e));
      return fail('Service momentanément indisponible', 503);
    }
  },

  // Every 10 minutes: feedback emails + unprinted-order alert.
  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    const site = (env.SITE_ORIGIN || 'https://kaycharly.fr').replace(/\/$/, '') + '/';
    ctx.waitUntil((async () => {
      try { console.log('feedback', JSON.stringify(await runFeedback(env, site))); } catch (e) { console.error('feedback failed', String(e)); }
      try { console.log('print alert', JSON.stringify(await runPrintAlert(env, site))); } catch (e) { console.error('print alert failed', String(e)); }
    })());
  },
};
