type ReceiptLine = { t: string; b: boolean; s: number; c: boolean };
function receiptLines(o: any): ReceiptLine[] {
  const pageW = 227, margin = 10, cols = (s: number) => Math.floor((pageW - 2 * margin) / (0.6 * s));
  const money = (c: number) => (Number(c) / 100).toFixed(2).replace(".", ",") + " €";
  const wrap = (t: string, w: number) => { const out: string[] = []; let l = ""; for (const x of String(t ?? "").split(/\s+/)) { if (!x) continue; for (let p = x; p; p = p.slice(w)) { const s = p.slice(0, w); if (l && (l + " " + s).length > w) { out.push(l); l = s; } else l = l ? l + " " + s : s; } } if (l) out.push(l); return out.length ? out : [""]; };
  const delivery = /livraison/i.test(o.pickup || "");
  const when = new Date(o.created_at || Date.now()).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  const L: ReceiptLine[] = [], add = (t: string, b = false, s = 9, c = false) => L.push({ t, b, s, c }), W = cols(9);
  const rule = () => add("-".repeat(W)), pair = (left: string, right: string, b: boolean, s = 9) => { const w = cols(s); wrap(left, w - right.length - 1).forEach((r, k) => add(k ? r : r.padEnd(w - right.length) + right, b && k === 0, s)); };
  add("KAY CHARLY", true, 15, true); add("Cuisine créole · Champcueil", false, 9, true); add("19 rue de la Marivoise", false, 9, true); add("07 60 62 95 72", false, 9, true); rule();
  add(delivery ? "LIVRAISON" : "À EMPORTER", true, 12, true); add("Reçu " + o.reference, true, 9, true); add(when, false, 9, true); rule();
  for (const x of wrap("Client : " + (o.customer_name || ""), W)) add(x, true);
  if (o.phone) add("Tél : " + o.phone);
  if (delivery && o.address) for (const x of wrap("Adresse : " + o.address, W)) add(x);
  add(delivery ? "Livraison entre 10h et 11h30" : "Retrait en boutique"); rule();
  for (const i of o.items || []) pair(i.quantity + " x " + i.name, money(Number(i.price) * Number(i.quantity)), true);
  rule(); pair("TOTAL", money(o.total), true, 11); add("À régler en espèces à la remise", false, 9, true);
  if (o.note) { rule(); add("REMARQUE", true); for (const x of wrap(o.note, W)) add(x, true); }
  rule(); add("Merci et à bientôt !", false, 9, true);
  return L;
}

export function receiptPdf(o: any): string {
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

export function receiptHtml(o: any): string {
  const h = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  const rows = receiptLines(o).map((l) => { const size = l.s >= 15 ? 20 : l.s >= 11 ? 15 : 13; return `<div style="font-size:${size}px;${l.b ? "font-weight:bold;" : ""}${l.c ? "text-align:center;" : ""}white-space:pre">${h(l.t)}</div>`; }).join("");
  return `<div style="margin:0 0 22px"><div style="font:bold 12px Arial,sans-serif;letter-spacing:2px;color:#173d30;margin:0 0 8px">REÇU À IMPRIMER</div><div style="display:inline-block;background:#fff;color:#000;border:1px dashed #000;padding:14px 16px;width:300px;font-family:'Courier New',Courier,monospace;line-height:1.45">${rows}</div></div>`;
}
