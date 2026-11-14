// Kay Charly · order-notifications
// After an order is saved, sends two emails through Brevo:
//   1. the customer's confirmation
//   2. the owner's order email: print button, receipt, client details, PDF receipt attached
// Single file on purpose, so it can be pasted into the Supabase dashboard editor.
//
// Secrets: BREVO_API_KEY (required) · OWNER_EMAIL, SENDER_EMAIL, SITE_ORIGIN (optional)
// Supabase provides SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

const SITE_ORIGIN = Deno.env.get("SITE_ORIGIN") || "https://maniksahni.github.io";
const ADMIN_URL = SITE_ORIGIN + "/kaycharly/admin.html";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") || "kaycharly91750@gmail.com";
const SENDER_EMAIL = Deno.env.get("SENDER_EMAIL") || "kaycharly37@gmail.com";

const SHOP = {
  name: "Kay Charly",
  tagline: "Cuisine créole · Champcueil",
  street: "19 rue de la Marivoise",
  address: "19 rue de la Marivoise, 91750 Champcueil",
  phone: "07 60 62 95 72",
  phoneLink: "+33760629572",
};

const HOURS_PICKUP = "Retrait en boutique aux horaires d’ouverture : midi 11 h 30 – 14 h tous les jours, soir 18 h – 21 h tous les jours.";
const HOURS_DELIVERY = "Commande avant 10 h : livraison prévue entre 10 h et 11 h 30. Kay Charly organise directement sa tournée.";

type Item = { name: string; quantity: number; price: number };
type Order = {
  reference: string; customer_name: string; customer_email: string; phone: string;
  address: string | null; note: string | null; pickup: string; items: Item[]; total: number; created_at: string;
};
type Mail = { subject: string; html: string; text: string; attachment?: { name: string; content: string } };

// ---------- helpers ----------

const cors = {
  "Access-Control-Allow-Origin": SITE_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);

const isDelivery = (o: Order) => /livraison/i.test(o.pickup || "");
const hoursFor = (o: Order) => (isDelivery(o) ? HOURS_DELIVERY : HOURS_PICKUP);

// Branded email frame shared by both emails.
function layout(content: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eae3d6;color:#173d30;font:16px Arial,sans-serif">
<div style="max-width:620px;margin:18px auto;background:#f8f2e7;border-radius:18px;overflow:hidden">
  <div style="padding:24px 26px;background:#0b1a14;color:#fff8e9">
    <div style="font:bold 30px Georgia,serif">${SHOP.name}</div>
    <div style="font-size:12px;letter-spacing:2px;color:#d8cba9">${SHOP.tagline.toUpperCase()}</div>
  </div>
  <div style="height:6px;background:#f2b53a"></div>
  ${content}
  <div style="padding:20px 26px;background:#0b1a14;color:#d7ddcf;font-size:13px;line-height:1.6">
    ${SHOP.name} · ${SHOP.street} · 91750 Champcueil<br>
    <a style="color:#f2b53a" href="tel:${SHOP.phoneLink}">${SHOP.phone}</a><br>
    À emporter &amp; livraison · règlement en espèces à la remise
  </div>
</div>
</body></html>`;
}

function fulfilmentBox(o: Order) {
  return `<div style="margin-top:14px;padding:18px;background:#e9efe7;border-radius:12px">
    <b>${isDelivery(o) ? "LIVRAISON" : "À EMPORTER"}</b>
    <p style="margin:8px 0">${esc(o.pickup)}</p>
    <p style="margin:0">${hoursFor(o)}</p>
  </div>`;
}

// ---------- receipt (same lines for the email and the PDF) ----------

type ReceiptLine = { text: string; bold: boolean; size: number; center: boolean };

const PDF_WIDTH = 227; // 80 mm in points
const PDF_MARGIN = 10;
const columnsAt = (size: number) => Math.floor((PDF_WIDTH - 2 * PDF_MARGIN) / (0.6 * size)); // Courier is 0.6 em wide

function wrap(text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of String(text ?? "").split(/\s+/)) {
    if (!word) continue;
    for (let rest = word; rest; rest = rest.slice(width)) {
      const part = rest.slice(0, width);
      if (line && (line + " " + part).length > width) { lines.push(line); line = part; }
      else line = line ? line + " " + part : part;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function receiptLines(o: Order): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const width = columnsAt(9);
  const price = (cents: number) => (Number(cents) / 100).toFixed(2).replace(".", ",") + " €";
  const add = (text: string, bold = false, size = 9, center = false) => lines.push({ text, bold, size, center });
  const rule = () => add("-".repeat(width));
  const row = (left: string, right: string, size = 9) => {
    const w = columnsAt(size);
    wrap(left, w - right.length - 1).forEach((part, i) => add(i ? part : part.padEnd(w - right.length) + right, i === 0, size));
  };
  const delivery = isDelivery(o);
  const date = new Date(o.created_at || Date.now()).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

  add("KAY CHARLY", true, 15, true);
  add(SHOP.tagline, false, 9, true);
  add(SHOP.street, false, 9, true);
  add(SHOP.phone, false, 9, true);
  rule();
  add(delivery ? "LIVRAISON" : "À EMPORTER", true, 12, true);
  add("Reçu " + o.reference, true, 9, true);
  add(date, false, 9, true);
  rule();
  wrap("Client : " + (o.customer_name || ""), width).forEach((l) => add(l, true));
  if (o.phone) add("Tél : " + o.phone);
  if (delivery && o.address) wrap("Adresse : " + o.address, width).forEach((l) => add(l));
  add(delivery ? "Livraison entre 10h et 11h30" : "Retrait en boutique");
  rule();
  for (const item of o.items || []) row(item.quantity + " x " + item.name, price(item.price * item.quantity));
  rule();
  row("TOTAL", price(o.total), 11);
  add("À régler en espèces à la remise", false, 9, true);
  if (o.note) {
    rule();
    add("REMARQUE", true);
    wrap(o.note, width).forEach((l) => add(l, true));
  }
  rule();
  add("Merci et à bientôt !", false, 9, true);
  return lines;
}

// Receipt as HTML for the email. 9 pt -> 13 px keeps the PDF proportions, so prices stay aligned.
function receiptHtml(o: Order) {
  const rows = receiptLines(o).map((l) =>
    `<div style="font-size:${(l.size * 13 / 9).toFixed(1)}px;line-height:1.45;${l.bold ? "font-weight:bold;" : ""}text-align:${l.center ? "center" : "left"};white-space:pre">${esc(l.text)}</div>`
  ).join("");
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse"><tr>
    <td style="background:#ffffff;color:#000000;border:1px dashed #6b6b6b;padding:14px 12px;font-family:'Courier New',Courier,monospace;box-shadow:0 2px 10px rgba(0,0,0,.08)">${rows}</td>
  </tr></table>`;
}

// Receipt as an 80 mm PDF (built by hand, no library), returned in base64.
function receiptPdf(o: Order) {
  const lines = receiptLines(o);
  const winAnsi: Record<string, number> = { "€": 0x80, "’": 0x27, "‘": 0x27, "“": 0x22, "”": 0x22, "–": 0x2d, "—": 0x2d, "œ": 0x9c, "Œ": 0x8c, "…": 0x85 };
  const encode = (text: string) => {
    let out = "";
    for (const ch of text.normalize("NFC")) {
      const code = ch.codePointAt(0) ?? 63;
      const byte = winAnsi[ch] ?? (code < 256 ? code : 63);
      out += ([0x28, 0x29, 0x5c].includes(byte) ? "\\" : "") + String.fromCharCode(byte);
    }
    return out;
  };
  const leading = (size: number) => size + 3.2;
  const height = Math.ceil(lines.reduce((h, l) => h + leading(l.size), 0) + 2 * PDF_MARGIN + 6);

  let y = height - PDF_MARGIN - 9;
  let stream = "";
  for (const l of lines) {
    const x = l.center ? (PDF_WIDTH - [...l.text].length * 0.6 * l.size) / 2 : PDF_MARGIN;
    stream += `BT /${l.bold ? "F2" : "F1"} ${l.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${encode(l.text)}) Tj ET\n`;
    y -= leading(l.size);
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((n) => String(n).padStart(10, "0") + " 00000 n \n").join("")
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}

// ---------- emails ----------

function customerEmail(o: Order): Mail {
  const firstName = String(o.customer_name || "").trim().split(/\s+/)[0];
  const rows = (o.items || []).map((i) =>
    `<tr><td style="padding:12px;border-bottom:1px solid #e7dfd0">${Number(i.quantity)} × ${esc(i.name)}</td><td align="right" style="padding:12px;border-bottom:1px solid #e7dfd0;white-space:nowrap">${euros(i.price * i.quantity)}</td></tr>`
  ).join("");

  const html = layout(`<div style="padding:26px">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">VOTRE COMMANDE EST CONFIRMÉE</p>
    <h1 style="margin:0 0 12px;font:normal 32px Georgia,serif">Merci ${esc(firstName)} !</h1>
    <p>Référence <b>${esc(o.reference)}</b> · <b style="color:#ad5b38">${euros(o.total)}</b></p>
    <p>Votre commande est confirmée et passe en préparation. Nous vous contacterons si besoin. Gardez cette référence pour la remise.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${rows}
      <tr><td style="padding:16px 12px"><b>Total · espèces à la remise</b></td><td align="right" style="padding:16px 12px"><b>${euros(o.total)}</b></td></tr>
    </table>
    ${fulfilmentBox(o)}
  </div>`);

  const text = [
    "KAY CHARLY · COMMANDE CONFIRMÉE",
    "Référence : " + o.reference,
    o.pickup,
    hoursFor(o),
    "",
    ...(o.items || []).map((i) => `${i.quantity} × ${i.name} — ${euros(i.price * i.quantity)}`),
    "",
    `Total : ${euros(o.total)} · espèces à la remise`,
    "",
    `${SHOP.name} · ${SHOP.address} · ${SHOP.phone}`,
  ].join("\n");

  return { subject: `Commande confirmée ${o.reference} · Kay Charly`, html, text };
}

function ownerEmail(o: Order): Mail {
  const delivery = isDelivery(o);
  const printUrl = ADMIN_URL + "#imprimer=" + encodeURIComponent(o.reference);
  const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(o.address || "");
  const where = delivery
    ? `<b>Adresse de livraison :</b> ${esc(o.address)}<br><a href="${esc(mapUrl)}" style="color:#38715b">Ouvrir dans Google Maps</a>`
    : "<b>Retrait en boutique</b>";

  const html = layout(`<div style="padding:26px 20px 8px;text-align:center">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">ACTION REQUISE</p>
    <h1 style="margin:0 0 10px;font:normal 30px Georgia,serif">Nouvelle commande à traiter</h1>
    <p style="margin:0 0 6px;font-size:17px">Référence <b>${esc(o.reference)}</b> · <b style="color:#ad5b38">${euros(o.total)}</b></p>
    <p style="margin:0 0 20px"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${delivery ? "#f2b53a" : "#e9efe7"};color:#0b1a14;font-weight:bold;font-size:13px;letter-spacing:1px">${delivery ? "LIVRAISON" : "À EMPORTER"}</span></p>
    <div style="margin:0 0 8px"><a href="${esc(printUrl)}" style="display:inline-block;padding:15px 26px;border-radius:999px;background:#0b1a14;color:#f2b53a;font:bold 17px Arial,sans-serif;text-decoration:none">🖨️&nbsp; Imprimer le reçu</a></div>
    <p style="margin:0 0 22px;font-size:13px;color:#4d5f56">Le reçu est aussi joint à cet e-mail en PDF : <b>Recu-${esc(o.reference)}.pdf</b></p>
    <p style="margin:0 0 10px;font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#173d30">REÇU</p>
    ${receiptHtml(o)}
  </div>
  <div style="padding:22px 20px 26px">
    <div style="padding:18px;background:#ffffff;border-radius:12px;line-height:1.7">
      <p style="margin:0 0 6px;font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#38715b">CLIENT</p>
      <b style="font-size:18px">${esc(o.customer_name)}</b><br>
      <a href="tel:${esc(o.phone)}" style="color:#173d30">📞 ${esc(o.phone)}</a><br>
      <a href="mailto:${esc(o.customer_email)}" style="color:#173d30">✉️ ${esc(o.customer_email)}</a>
      <p style="margin:10px 0 0">${where}</p>
    </div>
    ${fulfilmentBox(o)}
    ${o.note ? `<div style="margin-top:14px;padding:16px 18px;background:#fff4d9;border-radius:12px"><b>Remarque du client :</b> ${esc(o.note)}</div>` : ""}
  </div>`);

  const text = [
    "KAY CHARLY · NOUVELLE COMMANDE À TRAITER",
    "Imprimer le reçu : " + printUrl,
    "(Reçu aussi joint en PDF.)",
    "",
    ...receiptLines(o).map((l) => l.text),
    "",
    `Client : ${o.customer_name} · ${o.phone} · ${o.customer_email}`,
    delivery ? "Adresse : " + o.address : "Retrait en boutique",
    o.pickup,
  ].join("\n");

  return {
    subject: `🔔 À TRAITER · ${euros(o.total)} · ${o.customer_name} · ${o.reference}`,
    html,
    text,
    attachment: { name: `Recu-${o.reference}.pdf`, content: receiptPdf(o) },
  };
}

// ---------- sending ----------

async function sendEmail(apiKey: string, to: string, replyTo: string, mail: Mail) {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: SHOP.name, email: SENDER_EMAIL },
      to: [{ email: to }],
      replyTo: { email: replyTo },
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      ...(mail.attachment ? { attachment: [mail.attachment] } : {}),
    }),
  });
  if (!response.ok) console.error("Brevo send failed", response.status, (await response.text()).slice(0, 300));
  return response.ok;
}

async function loadOrder(reference: string): Promise<Order | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase is not configured");
  const query = new URLSearchParams({
    select: "reference,customer_name,customer_email,phone,address,note,pickup,items,total,created_at",
    reference: "eq." + reference,
    limit: "1",
  });
  const response = await fetch(`${url}/rest/v1/kc_orders?${query}`, { headers: { apikey: key, Authorization: "Bearer " + key } });
  if (!response.ok) throw new Error("Order lookup failed: " + response.status);
  const [order] = await response.json();
  return order ?? null;
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && requestOrigin !== SITE_ORIGIN) return json({ error: "Origin not allowed" }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) return json({ error: "Order email service is not configured" }, 503);

  let reference = "";
  try { reference = String((await req.json())?.reference || "").trim(); }
  catch { return json({ error: "Invalid request" }, 400); }
  if (!/^KC-[A-F0-9]{10}$/.test(reference)) return json({ error: "Invalid order reference" }, 400);

  try {
    const order = await loadOrder(reference);
    if (!order?.customer_email) return json({ error: "Order or customer email not found" }, 404);

    const [customerSent, ownerSent] = await Promise.all([
      sendEmail(apiKey, order.customer_email, OWNER_EMAIL, customerEmail(order)),
      sendEmail(apiKey, OWNER_EMAIL, order.customer_email, ownerEmail(order)),
    ]);
    if (!customerSent || !ownerSent) {
      return json({ customer_sent: customerSent, owner_sent: ownerSent, error: "One or more emails could not be sent" }, 502);
    }
    return json({ customer_sent: true, owner_sent: true });
  } catch (error) {
    console.error("Order email failed", String(error));
    return json({ error: "Order email service is unavailable" }, 503);
  }
});
