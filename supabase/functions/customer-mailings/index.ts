// Kay Charly · customer-mailings
// Two kinds of customer emails, sent through Brevo:
//   • action "menu"     – the owner, from the admin, sends today's/tomorrow's "plats du jour" to every
//                         customer who ever ordered (except unsubscribed). Needs an admin login.
//                         With preview: true it only returns the email and the recipient list.
//   • action "feedback" – called every 10 minutes by pg_cron. 30 minutes after the end of each order's
//                         service window it sends "Comment était votre repas ?" with 1–5 star links.
//                         Safe to call by anyone: it only sends emails that are due and not sent yet.
// Single file on purpose, so it can be pasted into the Supabase dashboard editor.
//
// Secrets: BREVO_API_KEY (required) · OWNER_EMAIL, SENDER_EMAIL, SITE_ORIGIN (optional)
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://maniksahni.github.io";
const SITE = SITE_ORIGIN + "/kaycharly/";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") || "kaycharly91750@gmail.com";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "kaycharly37@gmail.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BREVO_KEY = Deno.env.get("BREVO_API_KEY") || "";

const SHOP = { name: "Kay Charly", street: "19 rue de la Marivoise", phone: "07 60 62 95 72", phoneLink: "+33760629572" };
const TOWNS = "Champcueil · Chevannes · Mondeville · Ballancourt · Mennecy · Ormoy · Fontenay-le-Vicomte";
const REVIEW_URL = "https://www.google.com/maps/search/?api=1&query=Kay+Charly+19+rue+de+la+Marivoise+91750+Champcueil";

type Order = { reference: string; customer_name: string; customer_email: string; pickup: string; items: { name: string; quantity: number }[]; created_at: string; status: string };
type Mail = { subject: string; html: string; text: string };

// ---------- helpers ----------
const cors = { "Access-Control-Allow-Origin": SITE_ORIGIN, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const euros = (cents: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
const firstName = (n: string) => String(n || "").trim().split(/\s+/)[0] || "";
const db = (path: string, init: RequestInit = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json", ...(init.headers || {}) } });

function layout(content: string, footerExtra = "") {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eae3d6;color:#173d30;font:16px Arial,sans-serif">
<div style="max-width:620px;margin:18px auto;background:#f8f2e7;border-radius:18px;overflow:hidden">
  <div style="padding:24px 26px;background:#0b1a14;color:#fff8e9"><div style="font:bold 30px Georgia,serif">${SHOP.name}</div><div style="font-size:12px;letter-spacing:2px;color:#d8cba9">CUISINE CRÉOLE · CHAMPCUEIL</div></div>
  <div style="height:6px;background:#f2b53a"></div>
  ${content}
  <div style="padding:20px 26px;background:#0b1a14;color:#d7ddcf;font-size:13px;line-height:1.6">${SHOP.name} · ${SHOP.street} · 91750 Champcueil<br><a style="color:#f2b53a" href="tel:${SHOP.phoneLink}">${SHOP.phone}</a>${footerExtra}</div>
</div></body></html>`;
}
const button = (href: string, label: string) => `<a href="${esc(href)}" style="display:inline-block;padding:15px 28px;border-radius:999px;background:#0b1a14;color:#f2b53a;font:bold 17px Arial,sans-serif;text-decoration:none">${label}</a>`;
const unsubscribeLine = (token: string) => `<br><span style="color:#9aa69e">Vous recevez cet e-mail car vous avez commandé chez Kay Charly. <a style="color:#d7ddcf" href="${esc(SITE + "desinscription.html?t=" + token)}">Ne plus recevoir ces e-mails</a></span>`;

async function sendEmail(to: string, mail: Mail, unsubscribeUrl?: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: SHOP.name, email: SENDER_EMAIL }, to: [{ email: to }], replyTo: { email: OWNER_EMAIL },
      subject: mail.subject, htmlContent: mail.html, textContent: mail.text,
      ...(unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` } } : {}),
    }),
  });
  if (!r.ok) console.error("Brevo send failed", r.status, (await r.text()).slice(0, 300));
  return r.ok;
}

// Token per customer email (unsubscribe link). Creates the row the first time.
async function tokensFor(emails: string[]) {
  if (!emails.length) return new Map<string, { token: string; unsubscribed: boolean }>();
  await db("kc_email_prefs?on_conflict=email", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(emails.map((email) => ({ email }))) });
  const list = emails.map((e) => `"${e.replace(/"/g, "")}"`).join(",");
  const rows = await (await db(`kc_email_prefs?select=email,token,unsubscribed_at&email=in.(${encodeURIComponent(list)})`)).json();
  return new Map<string, { token: string; unsubscribed: boolean }>(rows.map((r: any) => [r.email, { token: r.token, unsubscribed: !!r.unsubscribed_at }]));
}

// ---------- Paris time ----------
function parisParts(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1 };
}
// UTC instant for a Paris wall-clock time (handles summer/winter time).
function parisTime(y: number, m: number, d: number, h: number, mi: number) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = parisParts(guess);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess;
  return guess - offset;
}
// When the "how was your meal" email is due: 30 minutes after the end of the order's service window.
//   Delivery: ordered before 10h → delivered 10h–11h30 that day → 12h00; otherwise the next day at 12h00.
//   Pickup:   lunch 11h30–14h every day → 14h30; evening 18h–21h Thursday–Saturday → 21h30.
export function feedbackDue(order: { pickup: string; created_at: string }) {
  const t = new Date(order.created_at).getTime(), p = parisParts(t), mins = p.h * 60 + p.mi;
  const at = (dayOffset: number, h: number, mi: number) => parisTime(p.y, p.m, p.d + dayOffset, h, mi);
  if (/livraison/i.test(order.pickup || "")) return mins < 600 ? at(0, 12, 0) : at(1, 12, 0);
  if (mins < 840) return at(0, 14, 30);
  if ([4, 5, 6].includes(p.dow) && mins < 1260) return at(0, 21, 30);
  return at(1, 14, 30);
}

// ---------- feedback email ----------
function feedbackEmail(o: Order, token: string, prefsToken: string): Mail {
  const link = (n: number) => `${SITE}avis.html?r=${encodeURIComponent(o.reference)}&t=${token}&n=${n}`;
  const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${esc(link(n))}" style="display:inline-block;margin:0 3px;font-size:40px;line-height:1;color:#f2b53a;text-decoration:none" title="${n}/5">★</a>`).join("");
  const items = (o.items || []).map((i) => `${Number(i.quantity)} × ${esc(i.name)}`).join("<br>");
  const html = layout(`<div style="padding:28px 24px;text-align:center">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">VOTRE AVIS COMPTE</p>
    <h1 style="margin:0 0 12px;font:normal 30px Georgia,serif">Comment était votre repas${firstName(o.customer_name) ? ", " + esc(firstName(o.customer_name)) : ""} ?</h1>
    <p style="margin:0 0 18px">Merci d’avoir commandé chez Kay Charly ! Un clic sur les étoiles suffit :</p>
    <div style="margin:0 0 8px">${stars}</div>
    <p style="margin:0 0 22px;font-size:13px;color:#4d5f56">1 = pas content · 5 = excellent</p>
    <div style="margin:0 auto 20px;max-width:420px;padding:14px 16px;background:#fff;border-radius:12px;font-size:14px;line-height:1.6;text-align:left"><b>Votre commande ${esc(o.reference)}</b><br>${items}</div>
    <p style="margin:0;font-size:14px">Un souci avec votre commande ? Répondez simplement à cet e-mail ou appelez le <a href="tel:${SHOP.phoneLink}" style="color:#173d30">${SHOP.phone}</a>.</p>
  </div>`, unsubscribeLine(prefsToken));
  const text = `Comment était votre repas ? Donnez une note de 1 à 5 :\n${[1, 2, 3, 4, 5].map((n) => `${n} : ${link(n)}`).join("\n")}\n\nCommande ${o.reference}\nUn souci ? Répondez à cet e-mail ou appelez le ${SHOP.phone}.`;
  return { subject: `Comment était votre repas${firstName(o.customer_name) ? ", " + firstName(o.customer_name) : ""} ? ⭐`, html, text };
}

async function runFeedback() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const rows: Order[] = await (await db(`kc_orders?select=reference,customer_name,customer_email,pickup,items,created_at,status&feedback_sent_at=is.null&archived_at=is.null&status=neq.Annul%C3%A9e&created_at=gt.${since}&order=created_at.asc&limit=200`)).json();
  const due = rows.filter((o) => o.customer_email && feedbackDue(o) <= Date.now() && !/^\s*test\b/i.test(o.customer_name || "")).slice(0, 50);
  if (!due.length) return { checked: rows.length, sent: 0 };
  const prefs = await tokensFor([...new Set(due.map((o) => o.customer_email.toLowerCase()))]);
  let sent = 0, skipped = 0;
  for (const o of due) {
    const token = crypto.randomUUID();
    // Claim the order first, so two runs can never send the same email twice.
    const claim = await db(`kc_orders?reference=eq.${o.reference}&feedback_sent_at=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ feedback_sent_at: new Date().toISOString(), feedback_token: token }) });
    if (!claim.ok || !(await claim.json()).length) continue;
    const pref = prefs.get(o.customer_email.toLowerCase());
    if (pref?.unsubscribed) { skipped++; continue; }
    if (await sendEmail(o.customer_email, feedbackEmail(o, token, pref?.token || ""), pref ? SITE + "desinscription.html?t=" + pref.token : undefined)) sent++;
  }
  return { checked: rows.length, due: due.length, sent, skipped };
}

// ---------- menu email ----------
// update: a menu was already sent today → "Menu mis à jour". message: optional short note from the owner.
async function menuEmail(when: "demain" | "aujourdhui", opts: { update?: boolean; message?: string } = {}) {
  const items = await (await db("kc_menu?select=name,description,price,photo&category=eq.Plats%20du%20jour&available=is.true&order=sort_order.asc")).json();
  const day = new Date(Date.now() + (when === "demain" ? 86400000 : 0)).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });
  const label = (opts.update ? "Mise à jour : " : "") + (when === "demain" ? (opts.update ? "le menu de demain" : "Le menu de demain") : (opts.update ? "le menu du jour" : "Le menu du jour"));
  const note = String(opts.message || "").trim().slice(0, 300);
  const photo = (p: string) => !p ? "" : /^https?:\/\//.test(p) ? p : SITE + p.replace(/^\.?\//, "");
  const rows = items.map((i: any) => `<tr>
      ${photo(i.photo) ? `<td style="padding:12px 0;border-bottom:1px solid #e7dfd0;width:74px;vertical-align:top"><img src="${esc(photo(i.photo))}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:10px;object-fit:cover"></td>` : ""}
      <td ${photo(i.photo) ? "" : 'colspan="2" '}style="padding:12px ${photo(i.photo) ? "10px" : "0"};border-bottom:1px solid #e7dfd0;vertical-align:top"><b style="font-size:17px">${esc(i.name)}</b>${i.description ? `<br><span style="font-size:14px;color:#4d5f56">${esc(i.description)}</span>` : ""}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e7dfd0;vertical-align:top;text-align:right;white-space:nowrap;font-weight:bold;color:#ad5b38">${Number(i.price) > 0 ? euros(i.price) : "Sur appel"}</td></tr>`).join("");
  const body = (token: string) => layout(`<div style="padding:28px 22px 10px;text-align:center">
      <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">${when === "demain" ? "POUR DEMAIN" : "AUJOURD’HUI"} · ${esc(day.toUpperCase())}</p>
      <h1 style="margin:0 0 8px;font:normal 32px Georgia,serif">${label}</h1>
      <p style="margin:0 0 6px">${opts.update ? "Petit changement : voici le menu à jour." : "Fait maison, cuisine créole. Commandez en ligne en 1 minute."}</p>
      ${note ? `<div style="margin:14px auto 4px;max-width:480px;padding:14px 16px;background:#fff4d9;border-left:5px solid #f2b53a;border-radius:10px;text-align:left;font-size:16px;line-height:1.5"><b>Le mot de Kay Charly :</b><br>${esc(note).replace(/\n/g, "<br>")}</div>` : ""}</div>
    <div style="padding:0 22px"><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table></div>
    <div style="padding:24px 22px;text-align:center">${button(SITE + "#carte", "Commander maintenant")}
      <div style="margin:22px 0 0;padding:16px;background:#e9efe7;border-radius:12px;font-size:14px;line-height:1.6;text-align:left">
        <b>Livraison gratuite</b> : commandez avant 10h, livré entre 10h et 11h30.<br><span style="color:#4d5f56">${TOWNS}</span><br>
        <b>À emporter</b> : midi 11h30 – 14h tous les jours, soir 18h – 21h du jeudi au samedi.<br>Paiement en espèces à la remise.</div></div>`, token ? unsubscribeLine(token) : "");
  const text = `${label} (${day}) chez Kay Charly\n\n${items.map((i: any) => `• ${i.name} — ${Number(i.price) > 0 ? euros(i.price) : "Sur appel"}`).join("\n")}\n\nCommander : ${SITE}#carte\nLivraison gratuite : commandez avant 10h, livré entre 10h et 11h30.\n${SHOP.phone}`;
  const text2 = (note ? `Le mot de Kay Charly : ${note}\n\n` : "") + text;
  return { subject: `${opts.update ? "🔄" : "🍛"} ${label} chez Kay Charly · ${day}`, body, text: text2, count: items.length };
}

async function recipients() {
  const rows = await (await db("kc_orders?select=customer_email,customer_name&status=neq.Annul%C3%A9e&archived_at=is.null&customer_email=not.is.null&limit=5000")).json();
  const emails = [...new Set(rows.filter((r: any) => !/^\s*test\b/i.test(r.customer_name || "")).map((r: any) => String(r.customer_email).trim().toLowerCase()).filter((e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))] as string[];
  const prefs = await tokensFor(emails);
  return emails.filter((e) => !prefs.get(e)?.unsubscribed).map((e) => ({ email: e, token: prefs.get(e)?.token || "" }));
}

async function isAdmin(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + jwt } });
  if (!u.ok) return false;
  const { id } = await u.json();
  const rows = await (await db(`kc_admins?select=user_id&user_id=eq.${id}`)).json();
  return Array.isArray(rows) && rows.length === 1;
}

async function runMenu(req: Request, body: any) {
  if (!(await isAdmin(req))) return json({ error: "Réservé à l’administrateur" }, 401);
  const when = body.when === "aujourdhui" ? "aujourdhui" : "demain";
  // Already sent a menu in the last 18 hours → this one is an update.
  const [last] = await (await db(`kc_mailings?select=created_at,sent,subject&kind=eq.menu&order=created_at.desc&limit=1`)).json();
  const update = !!last && Date.now() - new Date(last.created_at).getTime() < 18 * 3600000;
  const mail = await menuEmail(when, { update, message: body.message });
  if (!mail.count) return json({ error: "Aucun plat du jour disponible : activez des plats du jour avant d’envoyer." }, 400);
  const list = await recipients();
  if (body.preview) {
    return json({ subject: mail.subject, html: mail.body(""), recipients: list.map((r) => r.email), last: last || null, update });
  }
  if (body.test) {   // "M’envoyer un test": only to the restaurant's own address, not logged as a mailing
    const ok = await sendEmail(OWNER_EMAIL, { subject: "[TEST] " + mail.subject, html: mail.body(""), text: mail.text });
    return json({ test: true, to: OWNER_EMAIL, sent: ok ? 1 : 0 });
  }
  // Only protects against a double click; a real update can be sent any time.
  if (last && Date.now() - new Date(last.created_at).getTime() < 2 * 60000 && !body.force) return json({ error: "Ce menu vient d’être envoyé il y a moins de 2 minutes.", recent: last.created_at }, 409);
  let sent = 0, failed = 0;
  for (const r of list) {
    const ok = await sendEmail(r.email, { subject: mail.subject, html: mail.body(r.token), text: mail.text + `\n\nNe plus recevoir ces e-mails : ${SITE}desinscription.html?t=${r.token}` }, `${SITE}desinscription.html?t=${r.token}`);
    ok ? sent++ : failed++;
  }
  await db("kc_mailings", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kind: "menu", subject: mail.subject.slice(0, 200), recipients: list.length, sent, failed }) });
  return json({ recipients: list.length, sent, failed });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== SITE_ORIGIN) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!BREVO_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: "Email service is not configured" }, 503);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  try {
    if (body.action === "feedback") return json(await runFeedback());
    if (body.action === "menu") return await runMenu(req, body);
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("customer-mailings failed", String(e));
    return json({ error: "Service unavailable" }, 503);
  }
});
