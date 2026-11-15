// Kay Charly · every email the site sends (Brevo), the 80 mm receipt (email + PDF) and Paris-time helpers.
// Emails sent by the Worker (order confirmation, owner receipt with PDF, feedback, menu, print alert).

export const SHOP = {
  name: 'Kay Charly',
  tagline: 'Cuisine créole · Champcueil',
  street: '19 rue de la Marivoise',
  address: '19 rue de la Marivoise, 91750 Champcueil',
  phone: '07 60 62 95 72',
  phoneLink: '+33760629572',
};
export const TOWNS = 'Champcueil · Chevannes · Mondeville · Ballancourt · Mennecy · Ormoy · Fontenay-le-Vicomte';
const HOURS_PICKUP = 'Retrait en boutique aux horaires d’ouverture : midi 11 h 30 – 14 h tous les jours, soir 18 h – 21 h du mercredi au dimanche.';
const HOURS_DELIVERY = 'Commande avant 10 h : livraison prévue entre 10 h et 11 h 30. Kay Charly organise directement sa tournée.';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const euros = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
export const isDelivery = (o) => /livraison/i.test(o.pickup || '');
const hoursFor = (o) => (isDelivery(o) ? HOURS_DELIVERY : HOURS_PICKUP);

// ---------- sending ----------
// mail: { subject, html, text, attachment?: { name, content(base64) } }
export async function sendEmail(env, to, mail, { replyTo, unsubscribeUrl } = {}) {
  if (!env.BREVO_API_KEY) { console.error('BREVO_API_KEY missing'); return false; }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: SHOP.name, email: env.SENDER_EMAIL || 'kaycharly37@gmail.com' },
      to: [{ email: to }],
      replyTo: { email: replyTo || ownerEmail(env) },
      subject: mail.subject, htmlContent: mail.html, textContent: mail.text,
      ...(mail.attachment ? { attachment: [mail.attachment] } : {}),
      ...(unsubscribeUrl ? { headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` } } : {}),
    }),
  });
  if (!r.ok) console.error('Brevo send failed', r.status, (await r.text()).slice(0, 300));
  return r.ok;
}
export const ownerEmail = (env) => env.OWNER_EMAIL || 'kaycharly91750@gmail.com';

// ---------- Paris time ----------
export function parisParts(t) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 };
}
// UTC instant for a Paris wall-clock time (handles summer/winter time).
export function parisTime(y, m, d, h, mi) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = parisParts(guess);
  return guess - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess);
}
export const hm = (t) => { const q = parisParts(new Date(t).getTime()); return `${String(q.h).padStart(2, '0')}h${String(q.mi).padStart(2, '0')}`; };
export const parisDate = (t) => { const q = parisParts(new Date(t).getTime()); return `${q.y}-${String(q.m).padStart(2, '0')}-${String(q.d).padStart(2, '0')}`; };

// When the "how was your meal" email is due: 30 minutes after the end of the order's service window.
//   Delivery: ordered before 10h → delivered 10h–11h30 that day → 12h00; otherwise the next day at 12h00.
//   Pickup:   lunch 11h30–14h every day → 14h30; evening 18h–21h Wednesday–Sunday → 21h30.
export function feedbackDue(order) {
  const t = new Date(order.created_at).getTime(), p = parisParts(t), mins = p.h * 60 + p.mi;
  const at = (dayOffset, h, mi) => parisTime(p.y, p.m, p.d + dayOffset, h, mi);
  if (/livraison/i.test(order.pickup || '')) return mins < 600 ? at(0, 12, 0) : at(1, 12, 0);
  if (mins < 840) return at(0, 14, 30);
  if (p.dow >= 3 && mins < 1260) return at(0, 21, 30);   // evening service: Wednesday (3) to Sunday (7)
  return at(1, 14, 30);
}

// ---------- frames ----------
function orderLayout(content) {
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
export function layout(content, footerExtra = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eae3d6;color:#173d30;font:16px Arial,sans-serif">
<div style="max-width:620px;margin:18px auto;background:#f8f2e7;border-radius:18px;overflow:hidden">
  <div style="padding:24px 26px;background:#0b1a14;color:#fff8e9"><div style="font:bold 30px Georgia,serif">${SHOP.name}</div><div style="font-size:12px;letter-spacing:2px;color:#d8cba9">CUISINE CRÉOLE · CHAMPCUEIL</div></div>
  <div style="height:6px;background:#f2b53a"></div>
  ${content}
  <div style="padding:20px 26px;background:#0b1a14;color:#d7ddcf;font-size:13px;line-height:1.6">${SHOP.name} · ${SHOP.street} · 91750 Champcueil<br><a style="color:#f2b53a" href="tel:${SHOP.phoneLink}">${SHOP.phone}</a>${footerExtra}</div>
</div></body></html>`;
}
export const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;padding:15px 28px;border-radius:999px;background:#0b1a14;color:#f2b53a;font:bold 17px Arial,sans-serif;text-decoration:none">${label}</a>`;
export const unsubscribeLine = (site, token) => `<br><span style="color:#9aa69e">Vous recevez cet e-mail car vous avez commandé chez Kay Charly. <a style="color:#d7ddcf" href="${esc(site + 'desinscription.html?t=' + token)}">Ne plus recevoir ces e-mails</a></span>`;

function fulfilmentBox(o) {
  return `<div style="margin-top:14px;padding:18px;background:#e9efe7;border-radius:12px">
    <b>${isDelivery(o) ? 'LIVRAISON' : 'À EMPORTER'}</b>
    <p style="margin:8px 0">${esc(o.pickup)}</p>
    <p style="margin:0">${hoursFor(o)}</p>
  </div>`;
}

// ---------- receipt (same lines for the email and the PDF) ----------
const PDF_WIDTH = 227; // 80 mm in points
const PDF_MARGIN = 10;
const columnsAt = (size) => Math.floor((PDF_WIDTH - 2 * PDF_MARGIN) / (0.6 * size)); // Courier is 0.6 em wide

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/)) {
    if (!word) continue;
    for (let rest = word; rest; rest = rest.slice(width)) {
      const part = rest.slice(0, width);
      if (line && (line + ' ' + part).length > width) { lines.push(line); line = part; }
      else line = line ? line + ' ' + part : part;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function receiptLines(o) {
  const lines = [];
  const width = columnsAt(9);
  const price = (cents) => (Number(cents) / 100).toFixed(2).replace('.', ',') + ' €';
  const add = (text, bold = false, size = 9, center = false) => lines.push({ text, bold, size, center });
  const rule = () => add('-'.repeat(width));
  const row = (left, right, size = 9) => {
    const w = columnsAt(size);
    wrap(left, w - right.length - 1).forEach((part, i) => add(i ? part : part.padEnd(w - right.length) + right, i === 0, size));
  };
  const delivery = isDelivery(o);
  const date = new Date(o.created_at || Date.now()).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
  add('KAY CHARLY', true, 15, true);
  add(SHOP.tagline, false, 9, true);
  add(SHOP.street, false, 9, true);
  add(SHOP.phone, false, 9, true);
  rule();
  add(delivery ? 'LIVRAISON' : 'À EMPORTER', true, 12, true);
  add('Reçu ' + o.reference, true, 9, true);
  add(date, false, 9, true);
  rule();
  wrap('Client : ' + (o.customer_name || ''), width).forEach((l) => add(l, true));
  if (o.phone) add('Tél : ' + o.phone);
  if (delivery && o.address) wrap('Adresse : ' + o.address, width).forEach((l) => add(l));
  add(delivery ? 'Livraison entre 10h et 11h30' : 'Retrait en boutique');
  rule();
  for (const item of o.items || []) row(item.quantity + ' x ' + item.name, price(item.price * item.quantity));
  rule();
  row('TOTAL', price(o.total), 11);
  add('À régler en espèces à la remise', false, 9, true);
  if (o.note) {
    rule();
    add('REMARQUE', true);
    wrap(o.note, width).forEach((l) => add(l, true));
  }
  rule();
  add('Merci et à bientôt !', false, 9, true);
  return lines;
}

// Receipt as HTML for the email. 9 pt -> 13 px keeps the PDF proportions, so prices stay aligned.
function receiptHtml(o) {
  const rows = receiptLines(o).map((l) =>
    `<div style="font-size:${(l.size * 13 / 9).toFixed(1)}px;line-height:1.45;${l.bold ? 'font-weight:bold;' : ''}text-align:${l.center ? 'center' : 'left'};white-space:pre">${esc(l.text)}</div>`
  ).join('');
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse"><tr>
    <td style="background:#ffffff;color:#000000;border:1px dashed #6b6b6b;padding:14px 12px;font-family:'Courier New',Courier,monospace;box-shadow:0 2px 10px rgba(0,0,0,.08)">${rows}</td>
  </tr></table>`;
}

// Receipt as an 80 mm PDF (built by hand, no library), returned in base64.
export function receiptPdf(o) {
  const lines = receiptLines(o);
  const winAnsi = { '€': 0x80, '’': 0x27, '‘': 0x27, '“': 0x22, '”': 0x22, '–': 0x2d, '—': 0x2d, 'œ': 0x9c, 'Œ': 0x8c, '…': 0x85 };
  const encode = (text) => {
    let out = '';
    for (const ch of text.normalize('NFC')) {
      const code = ch.codePointAt(0) ?? 63;
      const byte = winAnsi[ch] ?? (code < 256 ? code : 63);
      out += ([0x28, 0x29, 0x5c].includes(byte) ? '\\' : '') + String.fromCharCode(byte);
    }
    return out;
  };
  const leading = (size) => size + 3.2;
  const height = Math.ceil(lines.reduce((h, l) => h + leading(l.size), 0) + 2 * PDF_MARGIN + 6);
  let y = height - PDF_MARGIN - 9;
  let stream = '';
  for (const l of lines) {
    const x = l.center ? (PDF_WIDTH - [...l.text].length * 0.6 * l.size) / 2 : PDF_MARGIN;
    stream += `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${encode(l.text)}) Tj ET\n`;
    y -= leading(l.size);
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}

// ---------- order emails ----------
export function customerOrderEmail(o) {
  const rows = (o.items || []).map((i) =>
    `<tr><td style="padding:12px;border-bottom:1px solid #e7dfd0">${Number(i.quantity)} × ${esc(i.name)}</td><td align="right" style="padding:12px;border-bottom:1px solid #e7dfd0;white-space:nowrap">${euros(i.price * i.quantity)}</td></tr>`
  ).join('');
  const html = orderLayout(`<div style="padding:26px">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">VOTRE COMMANDE EST CONFIRMÉE</p>
    <h1 style="margin:0 0 12px;font:normal 32px Georgia,serif">Merci ${esc(firstName(o.customer_name))} !</h1>
    <p>Référence <b>${esc(o.reference)}</b> · <b style="color:#ad5b38">${euros(o.total)}</b></p>
    <p>Votre commande est confirmée et passe en préparation. Nous vous contacterons si besoin. Gardez cette référence pour la remise.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${rows}
      <tr><td style="padding:16px 12px"><b>Total · espèces à la remise</b></td><td align="right" style="padding:16px 12px"><b>${euros(o.total)}</b></td></tr>
    </table>
    ${fulfilmentBox(o)}
  </div>`);
  const text = [
    'KAY CHARLY · COMMANDE CONFIRMÉE', 'Référence : ' + o.reference, o.pickup, hoursFor(o), '',
    ...(o.items || []).map((i) => `${i.quantity} × ${i.name} — ${euros(i.price * i.quantity)}`), '',
    `Total : ${euros(o.total)} · espèces à la remise`, '', `${SHOP.name} · ${SHOP.address} · ${SHOP.phone}`,
  ].join('\n');
  return { subject: `Commande confirmée ${o.reference} · Kay Charly`, html, text };
}

export function ownerOrderEmail(o, site) {
  const delivery = isDelivery(o);
  const printUrl = site + 'admin.html#imprimer=' + encodeURIComponent(o.reference);
  const mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address || '');
  const where = delivery
    ? `<b>Adresse de livraison :</b> ${esc(o.address)}<br><a href="${esc(mapUrl)}" style="color:#38715b">Ouvrir dans Google Maps</a>`
    : '<b>Retrait en boutique</b>';
  const html = orderLayout(`<div style="padding:26px 20px 8px;text-align:center">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">ACTION REQUISE</p>
    <h1 style="margin:0 0 10px;font:normal 30px Georgia,serif">Nouvelle commande à traiter</h1>
    <p style="margin:0 0 6px;font-size:17px">Référence <b>${esc(o.reference)}</b> · <b style="color:#ad5b38">${euros(o.total)}</b></p>
    <p style="margin:0 0 20px"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:${delivery ? '#f2b53a' : '#e9efe7'};color:#0b1a14;font-weight:bold;font-size:13px;letter-spacing:1px">${delivery ? 'LIVRAISON' : 'À EMPORTER'}</span></p>
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
    ${o.note ? `<div style="margin-top:14px;padding:16px 18px;background:#fff4d9;border-radius:12px"><b>Remarque du client :</b> ${esc(o.note)}</div>` : ''}
  </div>`);
  const text = [
    'KAY CHARLY · NOUVELLE COMMANDE À TRAITER', 'Imprimer le reçu : ' + printUrl, '(Reçu aussi joint en PDF.)', '',
    ...receiptLines(o).map((l) => l.text), '',
    `Client : ${o.customer_name} · ${o.phone} · ${o.customer_email}`,
    delivery ? 'Adresse : ' + o.address : 'Retrait en boutique', o.pickup,
  ].join('\n');
  return {
    subject: `🔔 À TRAITER · ${euros(o.total)} · ${o.customer_name} · ${o.reference}`,
    html, text,
    attachment: { name: `Recu-${o.reference}.pdf`, content: receiptPdf(o) },
  };
}

// ---------- feedback email ----------
export function feedbackEmail(o, token, prefsToken, site) {
  const link = (n) => `${site}avis.html?r=${encodeURIComponent(o.reference)}&t=${token}&n=${n}`;
  const stars = [1, 2, 3, 4, 5].map((n) => `<a href="${esc(link(n))}" style="display:inline-block;margin:0 3px;font-size:40px;line-height:1;color:#f2b53a;text-decoration:none" title="${n}/5">★</a>`).join('');
  const items = (o.items || []).map((i) => `${Number(i.quantity)} × ${esc(i.name)}`).join('<br>');
  const fn = firstName(o.customer_name);
  const html = layout(`<div style="padding:28px 24px;text-align:center">
    <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">VOTRE AVIS COMPTE</p>
    <h1 style="margin:0 0 12px;font:normal 30px Georgia,serif">Comment était votre repas${fn ? ', ' + esc(fn) : ''} ?</h1>
    <p style="margin:0 0 18px">Merci d’avoir commandé chez Kay Charly ! Un clic sur les étoiles suffit :</p>
    <div style="margin:0 0 8px">${stars}</div>
    <p style="margin:0 0 22px;font-size:13px;color:#4d5f56">1 = pas content · 5 = excellent</p>
    <div style="margin:0 auto 20px;max-width:420px;padding:14px 16px;background:#fff;border-radius:12px;font-size:14px;line-height:1.6;text-align:left"><b>Votre commande ${esc(o.reference)}</b><br>${items}</div>
    <p style="margin:0;font-size:14px">Un souci avec votre commande ? Répondez simplement à cet e-mail ou appelez le <a href="tel:${SHOP.phoneLink}" style="color:#173d30">${SHOP.phone}</a>.</p>
  </div>`, prefsToken ? unsubscribeLine(site, prefsToken) : '');
  const text = `Comment était votre repas ? Donnez une note de 1 à 5 :\n${[1, 2, 3, 4, 5].map((n) => `${n} : ${link(n)}`).join('\n')}\n\nCommande ${o.reference}\nUn souci ? Répondez à cet e-mail ou appelez le ${SHOP.phone}.`;
  return { subject: `Comment était votre repas${fn ? ', ' + fn : ''} ? ⭐`, html, text };
}

// ---------- menu email ----------
// update: a menu was already sent recently → "Mise à jour". message: optional short note from the owner.
export function menuEmail(items, site, when, opts = {}) {
  const day = new Date(Date.now() + (when === 'demain' ? 86400000 : 0)).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });
  const label = (opts.update ? 'Mise à jour : ' : '') + (when === 'demain' ? (opts.update ? 'le menu de demain' : 'Le menu de demain') : (opts.update ? 'le menu du jour' : 'Le menu du jour'));
  const note = String(opts.message || '').trim().slice(0, 300);
  const photo = (p) => !p ? '' : /^https?:\/\//.test(p) ? p : site + p.replace(/^\.?\//, '');
  const rows = items.map((i) => `<tr>
      ${photo(i.photo) ? `<td style="padding:12px 0;border-bottom:1px solid #e7dfd0;width:74px;vertical-align:top"><img src="${esc(photo(i.photo))}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:10px;object-fit:cover"></td>` : ''}
      <td ${photo(i.photo) ? '' : 'colspan="2" '}style="padding:12px ${photo(i.photo) ? '10px' : '0'};border-bottom:1px solid #e7dfd0;vertical-align:top"><b style="font-size:17px">${esc(i.name)}</b>${i.description ? `<br><span style="font-size:14px;color:#4d5f56">${esc(i.description)}</span>` : ''}</td>
      <td style="padding:12px 0;border-bottom:1px solid #e7dfd0;vertical-align:top;text-align:right;white-space:nowrap;font-weight:bold;color:#ad5b38">${Number(i.price) > 0 ? euros(i.price) : 'Sur appel'}</td></tr>`).join('');
  const body = (token) => layout(`<div style="padding:28px 22px 10px;text-align:center">
      <p style="margin:0 0 6px;color:#38715b;font-size:12px;font-weight:bold;letter-spacing:2px">${when === 'demain' ? 'POUR DEMAIN' : 'AUJOURD’HUI'} · ${esc(day.toUpperCase())}</p>
      <h1 style="margin:0 0 8px;font:normal 32px Georgia,serif">${label}</h1>
      <p style="margin:0 0 6px">${opts.update ? 'Petit changement : voici le menu à jour.' : 'Fait maison, cuisine créole. Commandez en ligne en 1 minute.'}</p>
      ${note ? `<div style="margin:14px auto 4px;max-width:480px;padding:14px 16px;background:#fff4d9;border-left:5px solid #f2b53a;border-radius:10px;text-align:left;font-size:16px;line-height:1.5"><b>Le mot de Kay Charly :</b><br>${esc(note).replace(/\n/g, '<br>')}</div>` : ''}</div>
    <div style="padding:0 22px"><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table></div>
    <div style="padding:24px 22px;text-align:center">${button(site + '#carte', 'Commander maintenant')}
      <div style="margin:22px 0 0;padding:16px;background:#e9efe7;border-radius:12px;font-size:14px;line-height:1.6;text-align:left">
        <b>Livraison gratuite</b> : commandez avant 10h, livré entre 10h et 11h30.<br><span style="color:#4d5f56">${TOWNS}</span><br>
        <b>À emporter</b> : midi 11h30 – 14h tous les jours, soir 18h – 21h du mercredi au dimanche.<br>Paiement en espèces à la remise.</div></div>`, token ? unsubscribeLine(site, token) : '');
  const text = `${label} (${day}) chez Kay Charly\n\n${items.map((i) => `• ${i.name} — ${Number(i.price) > 0 ? euros(i.price) : 'Sur appel'}`).join('\n')}\n\nCommander : ${site}#carte\nLivraison gratuite : commandez avant 10h, livré entre 10h et 11h30.\n${SHOP.phone}`;
  return { subject: `${opts.update ? '🔄' : '🍛'} ${label} chez Kay Charly · ${day}`, body, text: (note ? `Le mot de Kay Charly : ${note}\n\n` : '') + text, count: items.length };
}

// ---------- unprinted order alert ----------
export function printAlertEmail(missing, phone, site) {
  const lines = missing.map((o) => `${o.reference} · ${o.customer_name} · reçue à ${hm(o.created_at)} · ${isDelivery(o) ? 'Livraison' : 'À emporter'} · ${euros(o.total)}`);
  const html = layout(`<div style="padding:26px 24px">
    <p style="margin:0 0 6px;color:#a82c22;font-size:12px;font-weight:bold;letter-spacing:2px">IMPRIMANTE</p>
    <h1 style="margin:0 0 12px;font:normal 28px Georgia,serif">${missing.length > 1 ? missing.length + ' commandes ne sont pas sorties' : 'Une commande n’est pas sortie'} de l’imprimante</h1>
    <div style="margin:0 0 16px;padding:14px 16px;background:#fff;border-radius:12px;font-size:15px;line-height:1.7">${lines.map(esc).join('<br>')}</div>
    <p style="margin:0 0 8px"><b>À vérifier :</b></p>
    <ol style="margin:0 0 18px;padding-left:20px;line-height:1.7"><li>Le téléphone est allumé, branché, et la page <b>Kay Charly</b> est ouverte à l’écran.</li><li>L’imprimante est allumée, avec du papier, capot fermé.</li><li>Si « Reconnecter » apparaît sur la page, touchez-le.</li></ol>
    <p style="margin:0 0 18px">Dès que la page est de nouveau ouverte, les commandes en attente s’impriment toutes seules.</p>
    <p style="margin:0">${button(site + 'admin.html', 'Ouvrir l’administration')}</p>
    <p style="margin:16px 0 0;font-size:13px;color:#4d5f56">Dernier signe de vie du téléphone (${esc(phone.device_name || 'téléphone')}) : ${esc(hm(phone.updated_at))}.</p>
  </div>`);
  const text = `Commande(s) non imprimée(s) :\n${lines.join('\n')}\n\nVérifiez : téléphone allumé et branché, page Kay Charly ouverte à l’écran ; imprimante allumée avec du papier. ${site}admin.html`;
  return { subject: `⚠️ Commande non imprimée : ${missing.map((o) => o.reference).join(', ')}`.slice(0, 180), html, text };
}
