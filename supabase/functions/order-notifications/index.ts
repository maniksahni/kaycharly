// Single-file Edge Function (deployed from the Supabase dashboard editor).
// Customer: confirmation email. Owner: order email with the printable receipt + a PDF copy attached.
const origin = Deno.env.get("SITE_ORIGIN") || "https://maniksahni.github.io";
const adminUrl = Deno.env.get("ADMIN_URL") || "https://maniksahni.github.io/kaycharly/admin.html";
const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n / 100);
const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join(""));
const b64url = (s: string) => b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const SHOP = "19 rue de la Marivoise, 91750 Champcueil";
const isDelivery = (o: any) => /livraison/i.test(o.pickup || "");
const scheduleText = (o: any) => isDelivery(o) ? "Commande avant 10 h : livraison prévue entre 10 h et 11 h 30. Kay Charly organise directement sa tournée." : "Retrait en boutique aux horaires d’ouverture : midi 11 h 30 – 14 h tous les jours, soir 18 h – 21 h du jeudi au samedi.";

async function token() {
  const form = new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID") || "", client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "", refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") || "", grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json(); if (!r.ok || !j.access_token) { console.error("OAuth refresh failed", r.status, j.error); throw new Error("Google authorization failed"); } return j.access_token as string;
}

const shell = (inner: string) => "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body style=\"margin:0;padding:0;background:#eae3d6;color:#173d30;font:16px Arial,sans-serif\"><div style=\"max-width:620px;margin:18px auto;background:#f8f2e7;border-radius:18px;overflow:hidden\"><div style=\"padding:24px 26px;background:#0b1a14;color:#fff8e9\"><div style=\"font:bold 30px Georgia,serif\">Kay Charly</div><div style=\"font-size:12px;letter-spacing:2px;color:#d8cba9\">CUISINE CRÉOLE · CHAMPCUEIL</div></div><div style=\"height:6px;background:#f2b53a\"></div>" + inner + "<div style=\"padding:20px 26px;background:#0b1a14;color:#d7ddcf;font-size:13px;line-height:1.6\">Kay Charly · 19 rue de la Marivoise · 91750 Champcueil<br><a style=\"color:#f2b53a\" href=\"tel:+33760629572\">07 60 62 95 72</a><br>À emporter &amp; livraison · règlement en espèces à la remise</div></div></body></html>";

function customerMail(o: any) {
  const delivery = isDelivery(o);
  const rows = (o.items || []).map((i: any) => "<tr><td style=\"padding:12px;border-bottom:1px solid #e7dfd0\">" + Number(i.quantity) + " × " + esc(i.name) + "</td><td align=\"right\" style=\"padding:12px;border-bottom:1px solid #e7dfd0;white-space:nowrap\">" + money(Number(i.price) * Number(i.quantity)) + "</td></tr>").join("");
  const first = String(o.customer_name || "").trim().split(/\s+/)[0];
  const html = shell("<div style=\"padding:26px\"><p style=\"margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px\">VOTRE COMMANDE EST CONFIRMÉE</p><h1 style=\"margin:0 0 12px;font:normal 32px Georgia,serif\">Merci " + esc(first) + " !</h1><p>Référence <b>" + esc(o.reference) + "</b> · <b style=\"color:#ad5b38\">" + money(Number(o.total)) + "</b></p><p>Votre commande est confirmée et passe en préparation. Nous vous contacterons si besoin. Gardez cette référence pour la remise.</p><table role=\"presentation\" style=\"width:100%;border-collapse:collapse\">" + rows + "<tr><td style=\"padding:16px 12px\"><b>Total · espèces à la remise</b></td><td align=\"right\" style=\"padding:16px 12px\"><b>" + money(Number(o.total)) + "</b></td></tr></table><div style=\"margin-top:18px;padding:18px;background:#e9efe7;border-radius:12px\"><b>" + (delivery ? "LIVRAISON" : "À EMPORTER") + "</b><p style=\"margin:8px 0\">" + esc(o.pickup) + "</p><p style=\"margin:0\">" + scheduleText(o) + "</p></div></div>");
  const text = "KAY CHARLY · COMMANDE CONFIRMÉE\nRéférence : " + o.reference + "\n" + o.pickup + "\n" + scheduleText(o) + "\n\n" + (o.items || []).map((i: any) => i.quantity + " × " + i.name + " — " + money(i.price * i.quantity)).join("\n") + "\n\nTotal : " + money(Number(o.total)) + " · espèces à la remise\n\nKay Charly · " + SHOP + " · 07 60 62 95 72";
  return { html, text, subject: "Commande confirmée " + o.reference + " · Kay Charly" };
}

type ReceiptLine = { t: string; b: boolean; s: number; c: boolean };
function receiptLines(o: any): ReceiptLine[] {
  const pageW = 227, margin = 10, cols = (s: number) => Math.floor((pageW - 2 * margin) / (0.6 * s));
  const eur = (c: number) => (Number(c) / 100).toFixed(2).replace(".", ",") + " €";
  const wrap = (t: string, w: number) => { const out: string[] = []; let l = ""; for (const x of String(t ?? "").split(/\s+/)) { if (!x) continue; for (let p = x; p; p = p.slice(w)) { const s = p.slice(0, w); if (l && (l + " " + s).length > w) { out.push(l); l = s; } else l = l ? l + " " + s : s; } } if (l) out.push(l); return out.length ? out : [""]; };
  const delivery = isDelivery(o);
  const when = new Date(o.created_at || Date.now()).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  const L: ReceiptLine[] = [], add = (t: string, b = false, s = 9, c = false) => L.push({ t, b, s, c }), W = cols(9);
  const rule = () => add("-".repeat(W)), pair = (left: string, right: string, b: boolean, s = 9) => { const w = cols(s); wrap(left, w - right.length - 1).forEach((r, k) => add(k ? r : r.padEnd(w - right.length) + right, b && k === 0, s)); };
  add("KAY CHARLY", true, 15, true); add("Cuisine créole · Champcueil", false, 9, true); add("19 rue de la Marivoise", false, 9, true); add("07 60 62 95 72", false, 9, true); rule();
  add(delivery ? "LIVRAISON" : "À EMPORTER", true, 12, true); add("Reçu " + o.reference, true, 9, true); add(when, false, 9, true); rule();
  for (const x of wrap("Client : " + (o.customer_name || ""), W)) add(x, true);
  if (o.phone) add("Tél : " + o.phone);
  if (delivery && o.address) for (const x of wrap("Adresse : " + o.address, W)) add(x);
  add(delivery ? "Livraison entre 10h et 11h30" : "Retrait en boutique"); rule();
  for (const i of o.items || []) pair(i.quantity + " x " + i.name, eur(Number(i.price) * Number(i.quantity)), true);
  rule(); pair("TOTAL", eur(o.total), true, 11); add("À régler en espèces à la remise", false, 9, true);
  if (o.note) { rule(); add("REMARQUE", true); for (const x of wrap(o.note, W)) add(x, true); }
  rule(); add("Merci et à bientôt !", false, 9, true);
  return L;
}

function receiptPdf(o: any): string {
  const pageW = 227, margin = 10, L = receiptLines(o);
  const map: Record<string, number> = { "€": 0x80, "’": 0x27, "‘": 0x27, "“": 0x22, "”": 0x22, "–": 0x2d, "—": 0x2d, "œ": 0x9c, "Œ": 0x8c, "…": 0x85 };
  const enc = (t: string) => { let s = ""; for (const c of t.normalize("NFC")) { const u = c.codePointAt(0) ?? 63; const b = map[c] ?? (u < 256 ? u : 63); s += (b === 0x28 || b === 0x29 || b === 0x5c ? "\\" : "") + String.fromCharCode(b); } return s; };
  const lead = (s: number) => s + 3.2, height = Math.ceil(L.reduce((a, l) => a + lead(l.s), 0) + 2 * margin + 6);
  let y = height - margin - 9, stream = "";
  for (const l of L) { const x = l.c ? (pageW - [...l.t].length * 0.6 * l.s) / 2 : margin; stream += `BT /${l.b ? "F2" : "F1"} ${l.s} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${enc(l.t)}) Tj ET\n`; y -= lead(l.s); }
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>", `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"; const offs: number[] = [];
  objs.forEach((b, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}

// Same lines as the PDF; font sizes keep the PDF proportions (9pt -> 13px) so columns stay aligned.
function receiptHtml(o: any): string {
  const rows = receiptLines(o).map(l => `<div style="font-size:${(l.s * 13 / 9).toFixed(1)}px;line-height:1.45;${l.b ? "font-weight:bold;" : ""}text-align:${l.c ? "center" : "left"};white-space:pre">${esc(l.t)}</div>`).join("");
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse"><tr><td style="background:#ffffff;color:#000000;border:1px dashed #6b6b6b;padding:14px 12px;font-family:'Courier New',Courier,monospace;box-shadow:0 2px 10px rgba(0,0,0,.08)">${rows}</td></tr></table>`;
}

function ownerMail(o: any) {
  const delivery = isDelivery(o), printUrl = adminUrl + "#imprimer=" + encodeURIComponent(o.reference);
  const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address || "");
  const btn = (href: string, label: string, bg: string, fg: string) => `<a href="${esc(href)}" style="display:inline-block;padding:15px 26px;border-radius:999px;background:${bg};color:${fg};font:bold 17px Arial,sans-serif;text-decoration:none">${label}</a>`;
  const where = delivery ? `<b>Adresse de livraison :</b> ${esc(o.address)}<br><a href="${esc(mapUrl)}" style="color:#38715b">Ouvrir dans Google Maps</a>` : "<b>Retrait en boutique</b>";
  const html = shell(
    `<div style="padding:26px 20px 8px;text-align:center"><p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">ACTION REQUISE</p><h1 style="margin:0 0 10px;font:normal 30px Georgia,serif">Nouvelle commande à traiter</h1><p style="margin:0 0 6px;font-size:17px">Référence <b>${esc(o.reference)}</b> · <b style="color:#ad5b38">${money(Number(o.total))}</b></p><p style="margin:0 0 20px"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${delivery ? "#f2b53a" : "#e9efe7"};color:#0b1a14;font-weight:bold;font-size:13px;letter-spacing:1px">${delivery ? "LIVRAISON" : "À EMPORTER"}</span></p>` +
    `<div style="margin:0 0 8px">${btn(printUrl, "🖨️&nbsp; Imprimer le reçu", "#0b1a14", "#f2b53a")}</div><p style="margin:0 0 22px;font-size:13px;color:#4d5f56">Le reçu est aussi joint à cet e-mail en PDF : <b>Recu-${esc(o.reference)}.pdf</b></p>` +
    `<p style="margin:0 0 10px;font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#173d30">REÇU</p>${receiptHtml(o)}</div>` +
    `<div style="padding:22px 20px 26px"><div style="padding:18px;background:#ffffff;border-radius:12px;line-height:1.7"><p style="margin:0 0 6px;font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#38715b">CLIENT</p><b style="font-size:18px">${esc(o.customer_name)}</b><br><a href="tel:${esc(o.phone)}" style="color:#173d30">📞 ${esc(o.phone)}</a><br><a href="mailto:${esc(o.customer_email)}" style="color:#173d30">✉️ ${esc(o.customer_email)}</a><p style="margin:10px 0 0">${where}</p></div>` +
    `<div style="margin-top:14px;padding:18px;background:#e9efe7;border-radius:12px"><b>${delivery ? "LIVRAISON" : "À EMPORTER"}</b><p style="margin:8px 0">${esc(o.pickup)}</p><p style="margin:0">${scheduleText(o)}</p></div>` +
    (o.note ? `<div style="margin-top:14px;padding:16px 18px;background:#fff4d9;border-radius:12px"><b>Remarque du client :</b> ${esc(o.note)}</div>` : "") + `</div>`);
  const text = "KAY CHARLY · NOUVELLE COMMANDE À TRAITER\nImprimer le reçu : " + printUrl + "\n(Reçu aussi joint en PDF.)\n\n" + receiptLines(o).map(l => l.t).join("\n") + "\n\nClient : " + o.customer_name + " · " + o.phone + " · " + o.customer_email + "\n" + (delivery ? "Adresse : " + o.address : "Retrait en boutique") + "\n" + o.pickup;
  return { html, text, subject: "🔔 À TRAITER · " + money(Number(o.total)) + " · " + o.customer_name + " · " + o.reference, attachment: { name: "Recu-" + o.reference + ".pdf", content: receiptPdf(o) } };
}

type Mail = { html: string; text: string; subject: string; attachment?: { name: string; content: string } };
async function send(access: string, from: string, to: string, reply: string, m: Mail) {
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  if (brevoKey) { const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": brevoKey, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ sender: { name: "Kay Charly", email: from }, to: [{ email: to }], replyTo: { email: reply }, subject: m.subject, htmlContent: m.html, textContent: m.text, ...(m.attachment ? { attachment: [m.attachment] } : {}) }) }); if (!r.ok) { console.error("Brevo send failed", r.status, (await r.text()).slice(0, 300)); return false; } return true; }
  const boundary = "kc_" + crypto.randomUUID().replaceAll("-", "");
  const raw = ["From: Kay Charly <" + from + ">", "To: " + to, "Reply-To: " + reply, "Subject: =?UTF-8?B?" + b64(m.subject) + "?=", "MIME-Version: 1.0", "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"", "", "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(m.text), "--" + boundary, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(m.html), "--" + boundary + "--", ""].join("\r\n");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" }, body: JSON.stringify({ raw: b64url(raw) }) });
  if (!r.ok) { console.error("Gmail send failed", r.status, (await r.text()).slice(0, 300)); return false; } return true;
}

Deno.serve(async req => {
  if (req.headers.get("origin") && req.headers.get("origin") !== origin) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors }); if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const owner = Deno.env.get("OWNER_EMAIL") || "kaycharly91750@gmail.com"; const from = Deno.env.get("GOOGLE_SENDER_EMAIL") || "kaycharly37@gmail.com";
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!url || !key) return json({ error: "Order email service is not configured" }, 503);
  let reference = ""; try { reference = String((await req.json())?.reference || "").trim(); } catch { return json({ error: "Invalid request" }, 400); }
  if (!/^KC-[A-F0-9]{10}$/.test(reference)) return json({ error: "Invalid order reference" }, 400);
  const q = new URLSearchParams({ select: "reference,customer_name,customer_email,phone,address,note,pickup,items,total,created_at", reference: "eq." + reference, limit: "1" });
  const found = await fetch(url + "/rest/v1/kc_orders?" + q, { headers: { apikey: key, Authorization: "Bearer " + key } }); if (!found.ok) { const details = await found.text(); console.error("Order lookup failed", found.status, details.slice(0, 500)); return json({ error: "Could not load order" }, 502); }
  const [order] = await found.json(); if (!order?.customer_email) return json({ error: "Order or customer email not found" }, 404);
  try { const access = Deno.env.get("BREVO_API_KEY") ? "" : await token(); const result = await Promise.all([send(access, from, order.customer_email, owner, customerMail(order)), send(access, from, owner, order.customer_email, ownerMail(order))]); if (!result[0] || !result[1]) return json({ customer_sent: result[0], owner_sent: result[1], error: "One or more emails could not be sent" }, 502); return json({ customer_sent: true, owner_sent: true }); } catch (e) { console.error("Order email failed", String(e)); return json({ error: "Order email service is unavailable" }, 503); }
});
