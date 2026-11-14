'use strict';
// Kay Charly · automatic ticket printing for the admin page.
//
// Printer: 80 mm thermal receipt printer (ESC/POS, USB + Bluetooth, auto-cutter), 72 mm printable.
// Tickets are continuous: as long as the order needs, then cut.
//
// Connected from the restaurant's Android phone only (Chrome). The big button tries, in order:
//   • ble – Bluetooth (Web Bluetooth, ESC/POS over a writable GATT characteristic), no pairing needed.
//   • usb – USB cable with a phone adapter (OTG) (WebUSB, ESC/POS). Reads paper/cover status.
// On a computer the tab only shows the phone's state (remote follow-up) and how to set the phone up.
//
// Every state change is reported to Supabase (kc_printer_status + kc_printer_events) so the setup can be
// followed from any other logged-in admin: which step the restaurant phone is stuck on, and why.

window.KCP = (() => {
  const CFG_KEY = 'kc-printer', DONE_KEY = 'kc-printed', DEV_KEY = 'kc-device';
  const MAX_AGE = 12 * 3600 * 1000;     // never auto-print orders older than 12 h
  const DOTS = 576;                      // 72 mm printable at 203 dpi
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ago = (t) => { const s = Math.round((Date.now() - new Date(t)) / 1000); return s < 60 ? `il y a ${s} s` : s < 3600 ? `il y a ${Math.round(s / 60)} min` : `le ${clock(t)}`; };
  const isPhone = /Android/i.test(navigator.userAgent);   // the printer is connected from the restaurant's Android phone
  const isChromium = () => (navigator.userAgentData?.brands || []).some((b) => /Chrom|Edge/.test(b.brand)) || (/Chrome\/|Edg\//.test(navigator.userAgent) && !/OPR\/|Firefox\//.test(navigator.userAgent));

  // ---------- saved settings (per device) ----------
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch {}
  if (cfg.mode === 'usb' && !cfg.usb) cfg = { sound: cfg.sound };   // old Brother setting: start fresh
  if (cfg.sound === undefined) cfg.sound = true;
  if (!cfg.name) cfg.name = isPhone ? 'Téléphone Android' : 'Ordinateur';
  if (!isPhone && cfg.mode) cfg = { sound: cfg.sound, name: cfg.name };   // printing from a computer is not used any more
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };
  let deviceId = '';
  try { deviceId = localStorage.getItem(DEV_KEY) || ''; if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(DEV_KEY, deviceId); } } catch { deviceId = crypto.randomUUID(); }

  // Order id -> time printed. 0 = order that already existed when printing was switched on.
  const readDone = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {}; } catch { return {}; } };
  const saveDone = (d) => { try { localStorage.setItem(DONE_KEY, JSON.stringify(Object.fromEntries(Object.entries(d).slice(-1000)))); } catch {} };

  // ---------- live state ----------
  let usbDev = null, epOut = 0, epIn = 0, pendingUsb = null;   // WebUSB
  let bleDev = null, bleChar = null;                             // Web Bluetooth
  let paper = null;            // { ok, unknown?, low?, text } from the last ESC/POS status read
  let lastError = '';
  let connectHelp = '';        // what to do after a failed connection attempt
  // Orders already there when the printer is connected are not printed; this snapshot is taken once per connection.
  let needBaseline = !!cfg.mode && !cfg.baselined;
  let wakeLock = null;

  const linked = () => (cfg.mode === 'usb' && !!usbDev) || (cfg.mode === 'ble' && !!bleChar);
  const MODE_NAME = { usb: 'câble USB', ble: 'Bluetooth', serial: 'Bluetooth appairé', browser: 'pilote de l’ordinateur' };   // last two: old rows in the follow-up

  // The ladder the big button walks down. A method that failed on this computer is skipped next time.
  // The ladder the big button walks down: Bluetooth first (no cable), then a USB cable with a phone adapter.
  const METHODS = [
    { id: 'ble', ok: () => !!navigator.bluetooth, button: '📶 Connecter l’imprimante (Bluetooth)', hint: 'Imprimante allumée, près du téléphone, Bluetooth du téléphone allumé. Si l’application de l’imprimante est ouverte, fermez-la. Touchez le bouton : une liste s’ouvre, attendez quelques secondes que l’imprimante apparaisse, touchez son nom, puis « Associer ». Si le téléphone demande « Appareils à proximité » ou la position : touchez « Autoriser ».' },
    { id: 'usb', ok: () => !!navigator.usb, button: '🔌 Connecter par câble USB (adaptateur téléphone)', hint: 'Branchez l’imprimante au téléphone avec un câble USB et un adaptateur USB-C (OTG). Touchez le bouton, puis le nom de l’imprimante.' },
  ];
  const failed = () => cfg.failed || [];
  // Everything tried: back to Bluetooth, with the explanation of what failed.
  const nextMethod = () => METHODS.find((m) => m.ok() && !failed().includes(m.id)) || METHODS[0];
  function markFailed(id) { cfg.failed = [...new Set([...failed(), id])]; saveCfg(); }
  const active = () => linked();
  const loggedIn = () => typeof session !== 'undefined' && !!session;

  // ---------- backend: status + event log ----------
  async function logEvent(event, detail = '') {
    if (!loggedIn()) return;
    try { await api('/rest/v1/kc_printer_events', { method: 'POST', body: { device_id: deviceId, event, detail: String(detail).slice(0, 300) }, headers: { Prefer: 'return=minimal' } }); } catch {}
  }
  let lastReport = '', lastReportAt = 0;
  // What this computer can do, so problems can be understood remotely.
  function diagnostics() {
    const chrome = (navigator.userAgent.match(/(Chrome|Edg)\/(\d+)/) || [])[2] || '';
    return {
      os: isPhone ? 'Android' : navigator.platform || '', browser_version: chrome,
      usb: !!navigator.usb, bluetooth: !!navigator.bluetooth,
      tried: failed(), next_method: cfg.mode ? null : nextMethod().id, paper: paper?.text || null,
      visible: !document.hidden, screen_awake: !!wakeLock, sound: !!cfg.sound, wizard: WZ.open ? wizardScreen().id : null,
    };
  }
  async function report(force = false) {
    if (!loggedIn() || !isPhone) return;   // only the phone has a printer to report
    const all = steps(), next = all.find((s) => !s.ok && !s.warn);
    const row = {
      device_id: deviceId, device_name: cfg.name.slice(0, 60), platform: navigator.userAgent.slice(0, 120),
      mode: cfg.mode || '', printer_name: (cfg.printerName || '').slice(0, 120), ready: active() && !next,
      stuck_step: next ? all.indexOf(next) + 1 : null, stuck_label: next ? `${next.label} — ${next.text}`.slice(0, 200) : '',
      steps: all.map((s, i) => ({ n: i + 1, label: s.label, ok: s.ok, warn: !!s.warn, text: s.text })),
      last_print_ref: cfg.lastPrint?.ref || '', last_print_at: cfg.lastPrint ? new Date(cfg.lastPrint.at).toISOString() : null,
      last_error: lastError.slice(0, 300),
      diag: diagnostics(),
    };
    const sig = JSON.stringify(row);
    if (!force && sig === lastReport && Date.now() - lastReportAt < 60000) return;
    lastReport = sig; lastReportAt = Date.now();
    try { await api('/rest/v1/kc_printer_status?on_conflict=device_id', { method: 'POST', body: { ...row, updated_at: new Date().toISOString() }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } }); } catch {}
  }

  // ---------- the ticket ----------
  const money = (n) => (n / 100).toFixed(2).replace('.', ',') + ' €';
  const KITCHEN = { am: 'Accras morue', ac: 'Accras crevette', 's-poulet': 'Sandwich poulet simple', 's-jambon': 'Sandwich jambon emmental', 's-crudites': 'Sandwich crudités' };

  function ticket(o) {
    const delivery = /livraison/i.test(o.pickup || '');
    const time = new Date(o.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
    const L = [
      { t: 'KAY CHARLY', size: 'title', center: 1 },
      { t: delivery ? 'LIVRAISON' : 'À EMPORTER', size: 'big', center: 1, invert: 1 },
      { t: o.reference, center: 1, bold: 1 },
      { t: time, center: 1 },
      { rule: 1 },
      { t: o.customer_name, size: 'big', bold: 1 },
      { t: o.phone, bold: 1 },
    ];
    if (delivery && o.address) L.push({ t: o.address, bold: 1 });
    L.push({ t: o.pickup || (delivery ? 'Livraison entre 10h et 11h30' : 'Retrait en boutique') }, { rule: 1 });
    for (const i of o.items || []) L.push({ left: `${i.quantity} x ${KITCHEN[i.id] || i.name}`, right: money(i.price * i.quantity), bold: 1 });
    L.push({ rule: 1 }, { left: 'TOTAL', right: money(o.total), size: 'big', bold: 1 }, { t: 'À régler en espèces à la remise', center: 1 });
    if (o.note) L.push({ rule: 1 }, { t: 'REMARQUE', bold: 1 }, { t: o.note, size: 'big', bold: 1 });
    L.push({ rule: 1 }, { t: 'Kay Charly · 07 60 62 95 72', center: 1 });
    return L;
  }
  const SAMPLE = {
    reference: 'KC-TEST000000', customer_name: 'TICKET TEST', phone: '07 60 62 95 72', address: '12 rue de la Gare, 91540 Mennecy',
    pickup: 'Livraison · 10 h – 11 h 30', total: 2900, note: 'Ticket test : ne pas préparer',
    items: [{ name: 'Menu poisson', quantity: 1, price: 1500 }, { name: 'Boudin noir', quantity: 1, price: 900 }, { name: 'Royal Soda Ananas', quantity: 2, price: 250 }],
  };
  const testTicket = () => [
    { t: 'KAY CHARLY', size: 'title', center: 1 },
    { t: 'IMPRIMANTE CONNECTÉE', size: 'big', center: 1, invert: 1 },
    { t: 'Les nouvelles commandes du site s’imprimeront ici automatiquement.', center: 1 },
    { t: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }), center: 1 },
    ...ticket({ ...SAMPLE, created_at: new Date().toISOString() }).slice(4),
  ];

  // Canvas drawing at the printer's real width (576 dots = 72 mm); height grows with the order.
  function draw(lines, W = DOTS) {
    const S = W / 576, sizes = { title: 56 * S, big: 38 * S, normal: 27 * S }, pad = 4 * S;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = (l) => `${l.bold || l.invert || l.size === 'title' ? '700' : '400'} ${sizes[l.size || 'normal']}px Arial,Helvetica,sans-serif`;
    const wrap = (t, w) => { const out = []; let line = ''; for (const word of String(t ?? '').split(/\s+/)) { const next = line ? line + ' ' + word : word; if (line && x.measureText(next).width > w) { out.push(line); line = word; } else line = next; } if (line) out.push(line); return out.length ? out : ['']; };
    const pass = (render) => {
      let y = 8 * S;
      for (const l of lines) {
        if (l.rule) { y += 10 * S; if (render) x.fillRect(pad, y, W - 2 * pad, 3 * S); y += 14 * S; continue; }
        x.font = font(l);
        const lh = sizes[l.size || 'normal'] * 1.3;
        if ('left' in l) {
          const pw = x.measureText(l.right).width;
          wrap(l.left, W - 2 * pad - pw - 20 * S).forEach((r, i) => {
            if (render) { x.textAlign = 'left'; x.fillText(r, pad, y + lh * 0.8); if (!i) { x.textAlign = 'right'; x.fillText(l.right, W - pad, y + lh * 0.8); } }
            y += lh;
          });
          y += 5 * S; continue;
        }
        for (const r of wrap(l.t, W - 2 * pad - (l.invert ? 32 * S : 0))) {
          if (l.invert && render) { x.fillRect(pad, y, W - 2 * pad, lh + 8 * S); x.fillStyle = '#fff'; }
          if (render) { x.textAlign = l.center ? 'center' : 'left'; x.fillText(r, l.center ? W / 2 : pad, y + lh * 0.8 + (l.invert ? 4 * S : 0)); x.fillStyle = '#000'; }
          y += lh + (l.invert ? 12 * S : 0);
        }
        y += 2 * S;
      }
      return Math.ceil(y + 16 * S);
    };
    c.width = W; c.height = 10; x.textBaseline = 'alphabetic';
    const H = pass(false); c.height = H;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#000'; pass(true);
    return c;
  }

  // ---------- ESC/POS ----------
  // Image printing (GS v 0) works on every ESC/POS printer and keeps French accents and € intact.
  function escpos(canvas) {
    const W = canvas.width, H = canvas.height, bytesPerRow = W / 8, img = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const parts = [new Uint8Array([0x1b, 0x40])];                          // ESC @  reset
    for (let top = 0; top < H; top += 240) {                               // bands keep the printer buffer happy
      const rows = Math.min(240, H - top), band = new Uint8Array(8 + bytesPerRow * rows);
      band.set([0x1d, 0x76, 0x30, 0, bytesPerRow & 255, bytesPerRow >> 8, rows & 255, rows >> 8]);
      for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
        const i = ((top + y) * W + x) * 4;
        if (img[i] < 128) band[8 + y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
      parts.push(band);
    }
    parts.push(new Uint8Array([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00])); // feed 4 lines, cut
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  async function writeBytes(data) {
    if (cfg.mode === 'usb') { for (let i = 0; i < data.length; i += 4096) await usbDev.transferOut(epOut, data.slice(i, i + 4096)); return; }
    if (cfg.mode === 'ble') {
      // Most printers take 180-byte packets; some only 20: drop to 20 once if a bigger packet is refused.
      // No timers here (a background tab slows timers down): every 10th packet waits for the printer's
      // acknowledgement instead, which keeps its buffer from overflowing.
      const fast = !!bleChar.properties.writeWithoutResponse && !!bleChar.writeValueWithoutResponse;
      const acked = !!bleChar.properties.write;
      let size = cfg.bleChunk || 180, n = 0;
      for (let i = 0; i < data.length;) {
        const chunk = data.slice(i, i + size);
        const withAck = !fast || (acked && n % 10 === 9);
        try { await (withAck ? bleChar.writeValue(chunk) : bleChar.writeValueWithoutResponse(chunk)); }
        catch (e) { if (size > 20) { size = 20; cfg.bleChunk = 20; saveCfg(); continue; } throw e; }
        i += chunk.length; n++;
      }
      return;
    }
  }
  async function readByte(timeout) {
    const t = sleep(timeout).then(() => null);
    if (cfg.mode === 'ble') return null;          // wireless printers do not answer status requests here
    if (cfg.mode === 'usb') {
      if (!epIn) return null;
      pendingUsb = pendingUsb || usbDev.transferIn(epIn, 64);
      const r = await Promise.race([pendingUsb, t]);
      if (!r) return null;
      pendingUsb = null;
      return r.data && r.data.byteLength ? r.data.getUint8(r.data.byteLength - 1) : null;
    }
    return null;
  }
  // DLE EOT real-time status: online, cover, paper.
  async function readPaper() {
    if (cfg.mode === 'ble') return { ok: true, unknown: true, text: 'Connectée sans fil (l’état du papier n’est pas lisible sans fil)' };
    try {
      const ask = async (n) => { await writeBytes(new Uint8Array([0x10, 0x04, n])); return readByte(900); };
      const s1 = await ask(1), s2 = await ask(2), s4 = await ask(4);
      if (s1 === null && s2 === null && s4 === null) return { ok: true, unknown: true, text: 'Connectée (l’imprimante n’envoie pas son état papier)' };
      if (s2 !== null && s2 & 0x04) return { ok: false, text: 'Capot ouvert : refermez le capot en appuyant fort jusqu’au clic.' };
      if ((s4 !== null && (s4 & 0x60) === 0x60) || (s2 !== null && s2 & 0x20)) return { ok: false, text: 'Plus de papier : mettez un nouveau rouleau 80 mm.' };
      if (s1 !== null && s1 & 0x08) return { ok: false, text: 'Imprimante hors ligne : vérifiez le capot et le papier, puis éteignez/rallumez-la.' };
      if (s4 !== null && (s4 & 0x0c) === 0x0c) return { ok: true, low: true, text: 'Papier bientôt fini : préparez un rouleau de rechange.' };
      return { ok: true, text: 'Papier OK · capot fermé' };
    } catch (e) { return { ok: false, text: 'L’imprimante ne répond plus : ' + e.message }; }
  }

  // ---------- connecting ----------
  async function openUsb(d) {
    await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const itf = d.configuration.interfaces.find((i) => i.alternates[0].endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'));
    if (!itf) throw Error('Cet appareil n’est pas une imprimante.');
    const eps = itf.alternates[0].endpoints;
    await d.claimInterface(itf.interfaceNumber);
    epOut = eps.find((e) => e.direction === 'out' && e.type === 'bulk').endpointNumber;
    epIn = (eps.find((e) => e.direction === 'in' && e.type === 'bulk') || {}).endpointNumber || 0;
    usbDev = d; pendingUsb = null;
  }
  // GATT services used by common Bluetooth receipt printers (the page may only open services listed here).
  const BLE_SERVICES = [0x18f0, 0xff00, 0xffe0, 0xfff0, 0xae30, 0xae00, 0xfee7, '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];
  async function openBle(d) {
    const server = await d.gatt.connect();
    let found = null;
    for (const svc of await server.getPrimaryServices()) {
      for (const ch of await svc.getCharacteristics()) {
        if (ch.properties.writeWithoutResponse || ch.properties.write) { found = ch; break; }
      }
      if (found) break;
    }
    if (!found) throw Error('Cet appareil Bluetooth n’accepte pas l’impression.');
    bleDev = d; bleChar = found;
    if (!d.__kc) {
      d.__kc = true;
      d.addEventListener('gattserverdisconnected', async () => {
        if (bleDev !== d) return;
        bleChar = null; paper = null; render();
        for (let i = 0; i < 5 && !bleChar && bleDev === d; i++) { await sleep(3000); try { await openBle(d); paper = await readPaper(); } catch {} }
        if (!bleChar) logEvent('print_fail', 'Bluetooth déconnecté');
        render();
      });
    }
  }
  async function closeAll() {
    try { const d = bleDev; bleDev = null; bleChar = null; d?.gatt?.disconnect(); } catch {}
    try { await usbDev?.close(); } catch {}
    usbDev = null; pendingUsb = null; paper = null;
  }
  // Reconnect silently to the printer this phone already allowed.
  async function reconnect() {
    try {
      if (cfg.mode === 'usb' && navigator.usb && !usbDev) {
        const d = (await navigator.usb.getDevices()).find((x) => x.vendorId === cfg.usb?.vendorId && x.productId === cfg.usb?.productId);
        if (d) await openUsb(d);
      }
      if (cfg.mode === 'ble' && navigator.bluetooth && !bleChar) {
        const known = navigator.bluetooth.getDevices ? await navigator.bluetooth.getDevices() : [];
        const d = known.find((x) => x.id === cfg.ble?.id) || bleDev;
        if (d) await openBle(d);
      }
    } catch (e) { lastError = 'Reconnexion impossible : ' + e.message; }
    if (linked()) paper = await readPaper();
    render();
  }

  const nameOfUsb = (d) => [d.manufacturerName, d.productName].filter(Boolean).join(' ') || `USB ${d.vendorId.toString(16)}:${d.productId.toString(16)}`;

  async function connectUsb() {
    connectHelp = ''; lastError = '';
    if (!navigator.usb) { connectHelp = 'Ce navigateur ne permet pas la connexion USB : ouvrez le site avec Google Chrome.'; render(); return false; }
    logEvent('connect_usb_click');
    let d;
    try { d = await navigator.usb.requestDevice({ filters: [] }); }
    catch (e) {
      markFailed('usb');
      connectHelp = 'L’imprimante n’a pas été choisie dans la liste USB. Si elle n’y était pas : vérifiez le câble, l’adaptateur et l’interrupteur, puis touchez le bouton vert pour réessayer le Bluetooth.';
      logEvent('connect_usb_cancel', e.message); render(); return false;
    }
    try {
      await closeAll();
      await openUsb(d);
      cfg = { ...cfg, mode: 'usb', usb: { vendorId: d.vendorId, productId: d.productId }, printerName: nameOfUsb(d), confirmedAt: undefined };
      saveCfg(); needBaseline = true;
      logEvent('connect_usb_ok', cfg.printerName);
      await afterConnect();
      return true;
    } catch (e) {
      usbDev = null; markFailed('usb');
      const busy = /access denied|claim|SecurityError|NetworkError/i.test(e.name + ' ' + e.message);
      connectHelp = busy
        ? 'Le téléphone n’a pas donné l’accès à l’imprimante USB. Débranchez/rebranchez le câble, puis touchez le bouton vert.'
        : 'Connexion USB impossible : ' + e.message;
      logEvent('connect_usb_fail', `${nameOfUsb(d)} · ${e.name}: ${e.message}`); render(); return false;
    }
  }

  async function connectBle() {
    connectHelp = ''; lastError = '';
    if (!navigator.bluetooth) { markFailed('ble'); connectHelp = 'Ce navigateur ne permet pas le Bluetooth sans fil.'; render(); return false; }
    logEvent('connect_ble_click');
    let d;
    try { d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES }); }
    catch (e) {
      markFailed('ble');
      connectHelp = /globally disabled|adapter|not available/i.test(e.message)
        ? 'Le Bluetooth du téléphone est éteint. Glissez le doigt du haut de l’écran vers le bas, touchez l’icône Bluetooth pour l’allumer, puis touchez de nouveau le bouton vert.'
        : 'L’imprimante n’a pas été choisie dans la liste. Vérifiez qu’elle est allumée et que son application est fermée, puis touchez le bouton vert.';
      logEvent('connect_ble_cancel', e.message); render(); return false;
    }
    try {
      await closeAll();
      await openBle(d);
      cfg = { ...cfg, mode: 'ble', ble: { id: d.id }, printerName: d.name || 'Imprimante Bluetooth', confirmedAt: undefined };
      saveCfg(); needBaseline = true;
      logEvent('connect_ble_ok', cfg.printerName);
      await afterConnect();
      return true;
    } catch (e) {
      bleDev = null; bleChar = null; markFailed('ble');
      connectHelp = 'Bluetooth impossible avec cette imprimante (' + e.message + '). Touchez le bouton vert pour essayer le câble USB.';
      logEvent('connect_ble_fail', `${d.name || ''} · ${e.name}: ${e.message}`); render(); return false;
    }
  }

  // The big button walks down the ladder: each failure on this phone moves it to the next method.
  async function connect() {
    if (!isPhone) return;
    return nextMethod().id === 'usb' ? connectUsb() : connectBle();
  }
  function restartLadder() { cfg.failed = []; connectHelp = ''; saveCfg(); render(); logEvent('ladder_reset'); }

  async function afterConnect() {
    needBaseline = true; cfg.baselined = false; saveCfg();
    if (linked()) paper = await readPaper();
    keepAwake(); render(); report(true);
    await sync();
    await test();
  }

  async function send(lines) {
    if (!linked()) await reconnect();
    if (!linked()) throw Error(cfg.mode === 'ble'
      ? 'Imprimante Bluetooth déconnectée : allumez-la, puis touchez « Reconnecter ».'
      : 'Imprimante déconnectée : rebranchez-la et allumez-la (nouvel essai automatique).');
    paper = await readPaper();
    if (!paper.ok) throw Error(paper.text);
    await writeBytes(escpos(draw(lines)));
    return 0;
  }

  // ---------- new-order sound ----------
  function chime() {
    if (!cfg.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175, 1568].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.start(t); o.stop(t + 0.4);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch {}
  }

  // ---------- keep the screen on ----------
  async function keepAwake() {
    if (!active() || document.visibilityState !== 'visible' || wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; render(); }); } catch {}
    render();
  }

  // ---------- guided steps: each checked live; the first one not done is "next" ----------
  // { ok, warn?, label, text, action?: [buttonLabel, actionName] }
  function steps() {
    const live = window.kcLastLoad && Date.now() - window.kcLastLoad < 60000;
    const S = [];
    S.push(isChromium()
      ? { ok: true, label: 'Navigateur compatible', text: 'Google Chrome / Microsoft Edge' }
      : { ok: false, label: 'Navigateur compatible', text: 'Ce navigateur ne sait pas parler à l’imprimante. Installez et ouvrez ce site avec Google Chrome.', action: ['⬇️ Télécharger Google Chrome', 'chrome'] });
    S.push(live
      ? { ok: true, label: 'Commandes reçues en direct', text: 'Connecté · nouvelle vérification toutes les 15 secondes' }
      : { ok: false, label: 'Commandes reçues en direct', text: 'Pas de connexion récente : vérifiez internet.', action: ['Revérifier', 'recheck'] });

    if (!cfg.mode) {
      const m = nextMethod();
      S.push({ ok: false, label: 'Imprimante connectée au site', text: (connectHelp ? connectHelp + ' ' : '') + 'Prochaine méthode : ' + MODE_NAME[m.id] + '.', action: [m.button, 'connect'] });
    } else {
      const how = MODE_NAME[cfg.mode];
      S.push(linked()
        ? { ok: true, label: 'Imprimante connectée au site', text: `Par ${how} · ${cfg.printerName || 'imprimante'}` }
        : cfg.mode === 'ble'
          ? { ok: false, label: 'Imprimante connectée au site', text: 'Connexion Bluetooth à refaire (après un redémarrage de la page, le Bluetooth demande un toucher). Imprimante allumée ? Touchez « Reconnecter ».', action: ['📶 Reconnecter', 'reconnectBle'] }
          : { ok: false, label: 'Imprimante connectée au site', text: `Connexion par ${how} perdue : vérifiez câble/alimentation, allumez l’imprimante, puis Revérifier.`, action: ['Revérifier', 'recheck'] });
      S.push(!linked() || !paper
        ? { ok: false, label: 'Papier et capot', text: 'En attente de l’imprimante…' }
        : paper.ok
          ? { ok: true, warn: !!(paper.low || paper.unknown), label: 'Papier et capot', text: paper.text }
          : { ok: false, label: 'Papier et capot', text: paper.text, action: ['Revérifier', 'recheck'] });
    }
    S.push(cfg.confirmedAt
      ? { ok: true, label: 'Ticket test sorti', text: `Confirmé le ${clock(cfg.confirmedAt)}` }
      : { ok: false, label: 'Ticket test sorti', text: 'Imprimez un ticket test et dites s’il est bien sorti.', action: cfg.mode ? ['Imprimer un ticket test', 'test'] : null });
    S.push(wakeLock
      ? { ok: true, label: 'Écran toujours allumé', text: 'L’écran reste allumé tant que cette page est ouverte.' }
      : { ok: false, warn: true, label: 'Écran toujours allumé', text: document.hidden ? 'Page cachée : revenez sur cette page dans Chrome.' : 'Laissez le téléphone sur cette page, branché au chargeur.' });
    S.push({ ok: cfg.sound, warn: !cfg.sound, label: 'Son des nouvelles commandes', text: cfg.sound ? 'Activé' : 'Coupé', action: cfg.sound ? null : ['Activer le son', 'toggleSound'] });
    S.push(lastError
      ? { ok: false, label: 'Impression des commandes', text: lastError, action: ['Réessayer', 'recheck'] }
      : cfg.lastPrint
        ? { ok: true, label: 'Impression des commandes', text: `Dernier ticket : ${cfg.lastPrint.ref} à ${clock(cfg.lastPrint.at)}` }
        : { ok: true, warn: true, label: 'Impression des commandes', text: 'En attente de la prochaine commande.' });
    return S;
  }

  function render() {
    const bar = $('printerBar'), list = $('printerChecks');
    if (!bar) return;
    const all = steps(), next = all.find((s) => !s.ok && !s.warn);
    const ready = active() && !next;
    bar.dataset.state = ready ? 'on' : 'off';
    $('printerState').textContent = !isPhone
      ? 'L’imprimante se connecte depuis le téléphone Android du restaurant. Son état : onglet Imprimante → Suivi à distance.'
      : ready ? 'Imprimante connectée : chaque nouvelle commande s’imprime automatiquement.'
      : !cfg.mode ? 'Imprimante pas encore connectée au site : ouvrez l’onglet Imprimante.'
      : 'Imprimante à vérifier : ' + next.text;
    if (!isPhone) bar.dataset.state = 'info';
    $('setupPanel').hidden = !isPhone; $('stepsPanel').hidden = !isPhone; $('phoneOnly').hidden = isPhone;
    list.innerHTML = all.map((s, i) => `<li class="${s.ok && !s.warn ? 'ok' : s.ok || s.warn ? 'warn' : 'ko'}${s === next ? ' next' : ''}"><span>${s.ok && !s.warn ? '✓' : i + 1}</span><div><b>${h(s.label)}</b><small>${h(s.text)}</small>${s.action ? `<button type="button" class="${s === next ? '' : 'secondary '}small" data-step="${s.action[1]}">${h(s.action[0])}</button>` : ''}</div></li>`).join('');
    $('printerNext').innerHTML = ready
      ? '<b>✓ Tout est prêt.</b> Laissez cette page ouverte : les commandes s’impriment toutes seules.'
      : `<b>À faire maintenant :</b> ${h(next.label)} — ${h(next.text)}`;
    $('printerNext').dataset.state = ready ? 'on' : 'off';
    $('printerMode').textContent = cfg.mode ? `${MODE_NAME[cfg.mode]} · ${cfg.printerName || ''}` : 'Aucune' + (failed().length ? ` (déjà essayé : ${failed().map((f) => MODE_NAME[f]).join(', ')})` : '');
    $('printerSound').textContent = cfg.sound ? '🔔 Son : activé' : '🔕 Son : coupé';
    const m = nextMethod();
    $('printerConnect').hidden = !!cfg.mode;
    $('printerConnect').textContent = m.button;
    $('printerConnectHint').textContent = m.hint;
    $('connectBox').hidden = !!cfg.mode;
    $('printerRestart').hidden = !failed().length || !!cfg.mode;
    $('printerOff').hidden = !cfg.mode;
    $('printerTest').disabled = !cfg.mode;
    if (document.activeElement !== $('deviceName')) $('deviceName').value = cfg.name;
    if (WZ.open && !WZ.busy) wizardRender();
    report();
  }

  // ---------- remote follow-up: the phone's printer, seen from any admin ----------
  const EVENT_LABELS = { wizard_open: 'Assistant ouvert', help_requested: '🆘 AIDE DEMANDÉE', try_other: 'Ticket pas sorti → autre méthode', connect_ble_click: 'Touché « Bluetooth »', connect_ble_ok: 'Connectée en Bluetooth', connect_ble_cancel: 'Liste Bluetooth fermée sans choisir', connect_ble_fail: 'Échec Bluetooth', ladder_reset: 'Recommencer les méthodes', remote_test: 'Ticket test demandé à distance', remote_test_done: 'Ticket test à distance imprimé ✓', remote_test_fail: 'Ticket test à distance impossible', connect_usb_click: 'Clic sur « Connecter » (USB)', connect_usb_ok: 'Connectée en USB', connect_usb_cancel: 'Liste USB fermée sans choisir', connect_usb_fail: 'Échec de connexion USB', test_print: 'Ticket test envoyé', test_yes: 'Ticket test confirmé ✓', test_no: 'Ticket test PAS sorti', test_fail: 'Ticket test impossible', print_ok: 'Commande imprimée', print_fail: 'Échec d’impression', disconnect: 'Impression arrêtée', page_open: 'Admin ouvert' };
  async function loadRemote() {
    if (!loggedIn() || $('printer')?.hidden) return;
    try {
      const [rows, events] = await Promise.all([
        api('/rest/v1/kc_printer_status?select=*&order=updated_at.desc&limit=10'),
        api('/rest/v1/kc_printer_events?select=*&order=created_at.desc&limit=15'),
      ]);
      const names = Object.fromEntries(rows.map((r) => [r.device_id, r.device_name]));
      $('remoteList').innerHTML = rows.map((r) => {
        const fresh = Date.now() - new Date(r.updated_at) < 3 * 60000;
        const state = r.ready && fresh ? 'ok' : !fresh ? 'warn' : 'ko';
        return `<li class="${state}"><span>${r.ready && fresh ? '✓' : !fresh ? '…' : r.stuck_step || '!'}</span><div><b>${h(r.device_name || 'Appareil')}${r.device_id === deviceId ? ' (cet appareil)' : ''}</b>`
          + `<small>${fresh ? 'En ligne' : 'Page fermée ou hors ligne'} · vu ${ago(r.updated_at)}${r.mode ? ' · ' + h(MODE_NAME[r.mode] || r.mode) : ''}${r.printer_name ? ' · ' + h(r.printer_name) : ''}</small>`
          + `<small>${r.ready ? 'Prêt : impression automatique active.' : r.stuck_step ? `Bloqué à l’étape ${r.stuck_step} : ${h(r.stuck_label)}` : 'Pas encore configuré.'}</small>`
          + (r.last_print_ref ? `<small>Dernier ticket : ${h(r.last_print_ref)} · ${clock(r.last_print_at)}</small>` : '')
          + (r.last_error ? `<small class="err">Erreur : ${h(r.last_error)}</small>` : '')
          + (r.diag?.wizard ? `<small>Assistant ouvert · écran : ${h(r.diag.wizard)}</small>` : '')
          + (r.diag && r.diag.os ? `<small>${h(r.diag.os)} · Chrome ${h(r.diag.browser_version || '?')} · USB ${r.diag.usb ? '✓' : '✕'} · Bluetooth ${r.diag.bluetooth ? '✓' : '✕'}${r.diag.tried?.length ? ' · déjà essayé : ' + h(r.diag.tried.map((t) => MODE_NAME[t] || t).join(', ')) : ''}${r.diag.visible === false ? ' · page cachée' : ''}</small>` : '')
          + (fresh && r.mode ? `<button type="button" class="secondary small" data-remote-test="${h(r.device_id)}" data-name="${h(r.device_name)}">Imprimer un ticket test là-bas</button>` : '') + '</div></li>';
      }).join('') || '<li class="warn"><span>…</span><div><b>Aucun téléphone pour l’instant</b><small>L’état apparaît ici dès que l’admin est ouvert sur le téléphone du restaurant.</small></div></li>';
      $('remoteEvents').innerHTML = events.map((e) => `<li><time>${clock(e.created_at)}</time> <b>${h(names[e.device_id] || 'Appareil')}</b> · ${h(EVENT_LABELS[e.event] || e.event)}${e.detail ? ` <small>${h(e.detail)}</small>` : ''}</li>`).join('') || '<li>Aucun événement.</li>';
    } catch (e) { $('remoteList').innerHTML = `<li class="warn"><span>!</span><div><b>Suivi indisponible</b><small>${h(e.message)}</small></div></li>`; }
  }

  // ---------- remote test print (asked from another admin device) ----------
  let lastCommand = 0, cmdReady = false;
  try { lastCommand = Number(localStorage.getItem('kc-printer-cmd') || 0); } catch {}
  async function pollCommands() {
    if (!loggedIn() || !isPhone) return;
    try {
      const rows = await api(`/rest/v1/kc_printer_events?select=id,detail&device_id=eq.${encodeURIComponent(deviceId)}&event=eq.remote_test&id=gt.${lastCommand}&order=id.asc&limit=5`);
      const skipOld = !cmdReady && lastCommand === 0; cmdReady = true;   // a new device never replays old requests
      if (!rows?.length) return;
      lastCommand = rows[rows.length - 1].id;
      try { localStorage.setItem('kc-printer-cmd', String(lastCommand)); } catch {}
      if (skipOld) return;
      if (!active()) { logEvent('remote_test_fail', 'Aucune imprimante connectée sur ce téléphone'); return; }
      try { await send(testTicket()); logEvent('remote_test_done', cfg.printerName || ''); }
      catch (e) { logEvent('remote_test_fail', e.message); }
    } catch {}
  }
  async function askRemoteTest(id, name) {
    await api('/rest/v1/kc_printer_events', { method: 'POST', body: { device_id: id, event: 'remote_test', detail: ('demandé depuis ' + cfg.name).slice(0, 300) }, headers: { Prefer: 'return=minimal' } });
    $('remoteNote').textContent = `Ticket test demandé sur « ${name} ». Il sort dans les 20 secondes si la page est ouverte là-bas.`;
    setTimeout(loadRemote, 25000);
  }

  // ---------- printing new orders ----------
  async function run() {
    if (!window.kcLastLoad) return;               // wait until orders have really loaded
    const done = readDone();
    if (needBaseline) { orders.forEach((o) => { done[o.id] ??= 0; }); saveDone(done); needBaseline = false; cfg.baselined = true; saveCfg(); renderOrders(); return; }
    const now = Date.now();
    const todo = orders.filter((o) => o.status === 'Nouvelle' && !(o.id in done) && now - new Date(o.created_at) < MAX_AGE)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));   // oldest first
    if (todo.some((o) => !chimed.has(o.id))) { todo.forEach((o) => chimed.add(o.id)); chime(); }   // once per new order
    for (const o of todo) {
      try {
        await send(ticket(o));
        done[o.id] = Date.now(); saveDone(done); lastError = '';
        cfg.lastPrint = { ref: o.reference, at: Date.now() }; saveCfg();
        logEvent('print_ok', o.reference);
      } catch (e) {
        const msg = `${o.reference} : ${e.message} Nouvel essai automatique dans 15 secondes.`;
        if (msg !== lastError) logEvent('print_fail', `${o.reference} · ${e.message}`);   // report each new problem once
        lastError = msg;
        break;
      } finally { renderOrders(); render(); }
    }
  }
  let running = false;
  const chimed = new Set();
  async function sync() {
    render();
    if (!isPhone || !cfg.mode || running) return;          // connected or not: run() reconnects and says why it waits
    running = true;
    try {
      // One tab prints at a time; the other waits its turn, then sees the order is already done.
      if (navigator.locks) await navigator.locks.request('kc-print', () => run());
      else await run();
    } finally { running = false; }
  }

  async function printOne(id) {
    const o = orders.find((x) => String(x.id) === String(id));
    if (!o) return;
    if (!active()) { KCReceipt.show(o, true); return; }   // no printer set up: receipt view with the print window
    try {
      await send(ticket(o)); const done = readDone(); done[o.id] = Date.now(); saveDone(done); lastError = '';
      cfg.lastPrint = { ref: o.reference, at: Date.now() }; saveCfg(); logEvent('print_ok', o.reference + ' (manuel)');
    } catch (e) { lastError = `${o.reference} : ${e.message}`; logEvent('print_fail', `${o.reference} · ${e.message}`); }
    renderOrders(); render();
  }

  function badge(o) {
    const t = readDone()[o.id];
    if (t) return `<span class="print-ok">Imprimé à ${new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}</span>`;
    return t === undefined && o.status === 'Nouvelle' && active() ? '<span class="print-wait">Impression en attente</span>' : '';
  }

  // ---------- test ticket ----------
  async function test() {
    if (!cfg.mode) return;
    lastError = '';
    $('testAsk').hidden = true;
    try {
      await send(testTicket());
      logEvent('test_print', cfg.printerName);
      $('testAsk').hidden = false;
      $('testAsk').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { lastError = 'Ticket test impossible : ' + e.message; logEvent('test_fail', e.message); }
    render();
  }
  function answer(ok) {
    $('testAsk').hidden = true;
    if (ok) { cfg.confirmedAt = Date.now(); cfg.failed = []; connectHelp = ''; lastError = ''; logEvent('test_yes'); }   // a ticket really came out: forget failed methods
    else {
      cfg.confirmedAt = undefined;
      lastError = 'Le ticket test n’est pas sorti : vérifiez le papier (côté brillant vers l’extérieur), refermez le capot, éteignez/rallumez l’imprimante puis Réessayer.';
      logEvent('test_no');
    }
    saveCfg(); render();
  }

  async function recheck() {
    lastError = '';
    if (cfg.mode) { if (!linked()) await reconnect(); else paper = await readPaper(); }
    await window.kcReload?.();
    render(); report(true); loadRemote();
  }
  async function turnOff() {
    if (!confirm('Arrêter l’impression automatique sur ce téléphone ?')) return;
    await closeAll();
    cfg = { sound: cfg.sound, name: cfg.name }; connectHelp = ''; saveCfg(); logEvent('disconnect');
    render(); renderOrders(); report(true);
  }
  function preview() { $('printerPreviewBox').replaceChildren(draw(testTicket())); $('printerPreview').showModal(); }

  // A real link (admin.js defines its own global open(), so window.open is not the browser's here).
  function openChrome() {
    const a = document.createElement('a');
    a.href = 'https://www.google.com/chrome/'; a.target = '_blank'; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
  }
  // ---------- full-screen assistant: one step per screen, big text, drawings, read aloud ----------
  // Screens 0–2 are physical (paper, cables) and move on with "C’est fait". From screen 3 on, the screen
  // shown follows the real state: not connected → connect, no confirmed ticket → test, window still
  // otherwise → done.
  const ART = {
    hello: '<svg viewBox="0 0 220 140"><rect x="40" y="40" width="140" height="80" rx="12" fill="#2b2f2d"/><rect x="60" y="28" width="100" height="22" rx="6" fill="#3d4340"/><rect x="78" y="6" width="64" height="40" fill="#fff" stroke="#999"/><line x1="86" y1="16" x2="134" y2="16" stroke="#444" stroke-width="3"/><line x1="86" y1="26" x2="124" y2="26" stroke="#888" stroke-width="3"/><circle cx="160" cy="100" r="6" fill="#3ddc84"/><text x="110" y="136" text-anchor="middle" font-size="13" fill="#1b4234">Votre imprimante</text></svg>',
    paper: '<svg viewBox="0 0 220 140"><rect x="30" y="70" width="160" height="56" rx="10" fill="#2b2f2d"/><path d="M40 70 L60 28 L180 28 L180 70 Z" fill="#555" opacity=".45"/><circle cx="110" cy="92" r="24" fill="#fff" stroke="#aaa" stroke-width="2"/><circle cx="110" cy="92" r="8" fill="#ddd"/><path d="M110 68 C 130 60 150 56 170 48" stroke="#fff" stroke-width="8" fill="none"/><path d="M160 40 l14 8 -14 8" fill="#f2b53a"/><text x="110" y="20" text-anchor="middle" font-size="12" fill="#1b4234">Le papier sort par-dessus, vers vous</text></svg>',
    power: '<svg viewBox="0 0 220 140"><rect x="70" y="40" width="110" height="70" rx="10" fill="#2b2f2d"/><circle cx="160" cy="95" r="6" fill="#3ddc84"/><path d="M70 60 C 40 60 40 110 14 110" stroke="#111" stroke-width="5" fill="none"/><rect x="2" y="102" width="16" height="16" rx="3" fill="#f2b53a"/><text x="10" y="134" text-anchor="middle" font-size="10" fill="#1b4234">Prise</text><path d="M70 80 C 50 80 50 30 20 30" stroke="#3a66d8" stroke-width="5" fill="none"/><rect x="4" y="22" width="18" height="16" rx="3" fill="#3a66d8"/><text x="13" y="16" text-anchor="middle" font-size="10" fill="#1b4234">USB → ordinateur</text><text x="160" y="126" text-anchor="middle" font-size="11" fill="#1b4234">lumière allumée</text></svg>',
    connect: '<svg viewBox="0 0 220 140"><rect x="10" y="30" width="90" height="62" rx="6" fill="#1b4234"/><rect x="18" y="38" width="74" height="46" fill="#f6efe2"/><rect x="28" y="54" width="54" height="16" rx="8" fill="#1b4234"/><text x="55" y="65" text-anchor="middle" font-size="8" fill="#fff">Connecter</text><path d="M104 62 h30" stroke="#f2b53a" stroke-width="4" stroke-dasharray="6 5"/><rect x="140" y="44" width="70" height="44" rx="8" fill="#2b2f2d"/><rect x="156" y="30" width="38" height="20" fill="#fff" stroke="#999"/><text x="110" y="126" text-anchor="middle" font-size="12" fill="#1b4234">Un clic, puis choisir l’imprimante</text></svg>',
    test: '<svg viewBox="0 0 220 140"><rect x="50" y="70" width="120" height="56" rx="10" fill="#2b2f2d"/><rect x="74" y="8" width="72" height="70" fill="#fff" stroke="#999"/><rect x="80" y="16" width="60" height="10" fill="#111"/><line x1="82" y1="38" x2="138" y2="38" stroke="#555" stroke-width="3"/><line x1="82" y1="50" x2="128" y2="50" stroke="#888" stroke-width="3"/><line x1="82" y1="62" x2="134" y2="62" stroke="#888" stroke-width="3"/></svg>',
    window: '<svg viewBox="0 0 220 140"><rect x="20" y="20" width="180" height="100" rx="8" fill="#fff" stroke="#bbb"/><rect x="20" y="20" width="180" height="18" rx="8" fill="#e3e3e3"/><text x="110" y="70" text-anchor="middle" font-size="13" fill="#a82c22">Fenêtre d’impression</text><path d="M60 92 l100 -40 M60 52 l100 40" stroke="#a82c22" stroke-width="5"/></svg>',
    done: '<svg viewBox="0 0 220 140"><circle cx="110" cy="66" r="50" fill="#1c6b43"/><path d="M84 66 l18 18 l36 -38" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const WZ = { open: false, i: 0, voice: false, helpSent: false, lastSpoken: '' };

  function wizardScreen() {
    // Wrong browser: say it first, nothing else can work until Chrome is used.
    if (!isChromium()) return { id: 'browser', title: 'Il faut Google Chrome', text: 'Ce navigateur ne sait pas parler à l’imprimante. Installez Google Chrome (gratuit, Play Store), puis ouvrez ce site avec Chrome.' };
    if (WZ.i < 3) return [
      { id: 'hello', title: 'Connectons l’imprimante', text: 'Ça prend deux minutes. Suivez les dessins, une étape à la fois. Vous pouvez appuyer sur « Lire à voix haute » à tout moment.', next: 'Commencer' },
      { id: 'paper', title: 'Mettre le papier', text: 'Ouvrez le capot de l’imprimante. Posez le rouleau pour que le papier sorte par-dessus, vers vous. Laissez dépasser un peu de papier, puis refermez le capot en appuyant fort jusqu’au clic.', next: 'C’est fait' },
      { id: 'power', title: 'Brancher et allumer', text: 'Branchez le câble électrique de l’imprimante dans la prise et appuyez sur son interrupteur : la petite lumière s’allume. Pas besoin de câble vers le téléphone. Branchez aussi le téléphone à son chargeur.', next: 'C’est fait, la lumière est allumée' },
    ][WZ.i];
    if (!cfg.mode) {
      const m = nextMethod();
      return { id: 'connect', title: 'Connecter l’imprimante au site', text: m.hint, method: m };
    }
    if (!cfg.confirmedAt) return { id: 'test', title: 'Un ticket est-il sorti de l’imprimante ?', text: 'Regardez l’imprimante : un ticket « IMPRIMANTE CONNECTÉE » doit sortir. S’il n’est pas encore sorti, attendez 10 secondes.' };
    return { id: 'done', title: 'Bravo, c’est prêt !', text: 'Laissez le téléphone sur cette page, branché au chargeur : l’écran reste allumé tout seul. Chaque nouvelle commande s’imprimera toute seule, avec un son. Si vous allez dans une autre application, revenez ici : les commandes arrivées entre-temps s’impriment.', next: 'Terminer' };
  }
  const SCREEN_ORDER = ['hello', 'paper', 'power', 'browser', 'connect', 'test', 'done'];
  ART.browser = ART.connect;
  ART.power = ART.power.replace(/<path d="M70 80[^>]*>/, '').replace(/<rect x="4" y="22"[^>]*>/, '').replace(/<text x="13" y="16"[^<]*<\/text>/, '');

  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR'; u.rate = 0.9;
      const fr = speechSynthesis.getVoices().find((v) => /^fr/i.test(v.lang));
      if (fr) u.voice = fr;
      speechSynthesis.speak(u);
    } catch {}
  }

  function wizardRender() {
    const box = $('wizard');
    if (!box || !WZ.open) return;
    const sc = wizardScreen(), pos = SCREEN_ORDER.indexOf(sc.id), total = 6;
    const shown = Math.min(pos > 3 ? pos - 1 : pos, total - 1) + 1;
    let act = '';
    if (sc.id === 'connect') {
      act = `<button type="button" class="wz-main" data-wz="connect">${h(sc.method.button)}</button>`
        + (connectHelp ? `<p class="wz-warn">${h(connectHelp)}</p>` : '')
        + (failed().length ? `<p class="wz-small">Déjà essayé : ${h(failed().map((f) => MODE_NAME[f]).join(', '))}. <button type="button" class="link" data-wz="restart">Recommencer depuis le début</button></p>` : '');
    } else if (sc.id === 'test') {
      act = !$('testAsk').hidden
        ? `<div class="wz-row"><button type="button" class="wz-main" data-wz="yes">✓ Oui, il est sorti</button><button type="button" class="wz-alt" data-wz="no">✕ Non, rien n’est sorti</button></div>`
        : `<button type="button" class="wz-main" data-wz="test">Imprimer un ticket test</button>`;
      if (lastError) act += `<p class="wz-warn">${h(lastError)}</p><div class="wz-row"><button type="button" class="wz-alt" data-wz="test">Réessayer le ticket</button><button type="button" class="wz-alt" data-wz="other">Essayer une autre méthode</button></div>`;
    } else if (sc.id === 'browser') {
      act = `<button type="button" class="wz-main" data-wz="chrome">⬇️ Télécharger Google Chrome</button>`;
    } else act = `<button type="button" class="wz-main" data-wz="next">${h(sc.next)}</button>`;
    box.innerHTML = `<div class="wz-card" role="dialog" aria-modal="true" aria-labelledby="wzTitle">
      <div class="wz-top"><span>Étape ${shown} sur ${total}</span><div class="wz-dots">${Array.from({ length: total }, (_, k) => `<i class="${k < shown ? 'on' : ''}"></i>`).join('')}</div><button type="button" class="wz-x" data-wz="close" aria-label="Fermer">✕</button></div>
      <div class="wz-art">${ART[sc.id]}</div>
      <h2 id="wzTitle">${h(sc.title)}</h2><p class="wz-text">${h(sc.text)}</p>
      <div class="wz-act">${act}</div>
      <div class="wz-foot">${WZ.i > 0 && WZ.i < 3 ? '<button type="button" class="wz-alt" data-wz="back">← Retour</button>' : ''}<button type="button" class="wz-alt" data-wz="voice">${WZ.voice ? '🔊 Voix activée' : '🔈 Lire à voix haute'}</button><button type="button" class="wz-alt" data-wz="help">🆘 J’ai besoin d’aide</button></div>
      ${WZ.helpSent ? '<p class="wz-small">Demande d’aide envoyée : la personne qui s’occupe du site voit à quelle étape vous êtes.</p>' : ''}
    </div>`;
    const say = sc.title + '. ' + sc.text;
    if (WZ.voice && say !== WZ.lastSpoken) { WZ.lastSpoken = say; speak(say); }
  }

  function openWizard() {
    WZ.open = true; WZ.helpSent = false;
    WZ.i = cfg.mode ? 3 : 0;
    $('wizard').hidden = false; document.body.classList.add('wz-on');
    logEvent('wizard_open'); wizardRender();
  }
  function closeWizard() {
    WZ.open = false; $('wizard').hidden = true; document.body.classList.remove('wz-on');
    try { speechSynthesis.cancel(); sessionStorage.setItem('kc-wz-closed', '1'); } catch {}
    document.querySelector('[data-tab="printer"]')?.click();
  }
  // Ticket did not come out with this method: forget it and go back to "connect" with the next one.
  async function tryOther() {
    const was = cfg.mode;
    if (was) markFailed(was);
    await closeAll();
    cfg = { sound: cfg.sound, name: cfg.name, failed: cfg.failed, bleChunk: cfg.bleChunk };
    connectHelp = `Le ticket n’est pas sorti par ${MODE_NAME[was] || 'cette méthode'}. Essayons la méthode suivante.`;
    lastError = ''; saveCfg(); logEvent('try_other', was || '');
    render(); wizardRender();
  }
  async function wizardAction(a) {
    const sc = wizardScreen();
    if (a === 'next') { if (sc.id === 'done') return closeWizard(); WZ.i++; }
    else if (a === 'back') WZ.i = Math.max(0, WZ.i - 1);
    else if (a === 'close') return closeWizard();
    else if (a === 'voice') { WZ.voice = !WZ.voice; WZ.lastSpoken = ''; if (!WZ.voice) try { speechSynthesis.cancel(); } catch {} }
    else if (a === 'help') { WZ.helpSent = true; logEvent('help_requested', `${sc.title} · ${(connectHelp || lastError || '').slice(0, 200)}`); report(true); }
    else if (a === 'connect') { WZ.busy = true; await connect(); WZ.busy = false; }
    else if (a === 'restart') restartLadder();
    else if (a === 'test') await test();
    else if (a === 'yes') answer(true);
    else if (a === 'no') answer(false);
    else if (a === 'other') await tryOther();
    else if (a === 'chrome') openChrome();
    wizardRender();
  }

  function init() {
    const actions = {
      connect, recheck, test,
      chrome: () => openChrome(),
      reconnectBle: async () => { try { if (bleDev) { await openBle(bleDev); paper = await readPaper(); render(); } else await connectBle(); } catch { await connectBle(); } },
      showSteps: () => $('stepsTitle').scrollIntoView({ behavior: 'smooth' }),
      toggleSound: () => $('printerSound').click(),
    };
    $('printerChecks').onclick = (e) => { const b = e.target.closest('[data-step]'); if (b) actions[b.dataset.step]?.(); };
    $('printerConnect').onclick = connect;
    $('printerBle').onclick = connectBle;
    $('printerRestart').onclick = restartLadder;
    $('remoteList').onclick = (e) => { const b = e.target.closest('[data-remote-test]'); if (b) { b.disabled = true; askRemoteTest(b.dataset.remoteTest, b.dataset.name); } };
    $('printerTest').onclick = test;
    $('testYes').onclick = () => answer(true);
    $('testNo').onclick = () => answer(false);
    $('printerRecheck').onclick = recheck;
    $('printerOff').onclick = turnOff;
    $('printerShow').onclick = preview;
    $('printerClose').onclick = () => $('printerPreview').close();
    $('printerSound').onclick = () => { cfg.sound = !cfg.sound; saveCfg(); if (cfg.sound) chime(); render(); };
    $('deviceName').onchange = (e) => { cfg.name = e.target.value.trim().slice(0, 60) || cfg.name; saveCfg(); render(); report(true); };
    $('printerGo').onclick = () => (cfg.mode || !isPhone ? document.querySelector('[data-tab="printer"]').click() : openWizard());
    $('printerWizard').onclick = openWizard;
    $('wizard').onclick = (e) => { const b = e.target.closest('[data-wz]'); if (b && !b.disabled) wizardAction(b.dataset.wz); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && WZ.open) closeWizard(); });
    window.addEventListener('hashchange', () => { if (location.hash === '#imprimante' && loggedIn() && isPhone) openWizard(); });
    document.addEventListener('visibilitychange', () => { keepAwake(); render(); if (!document.hidden && cfg.mode && !linked()) reconnect().then(sync); });
    navigator.usb?.addEventListener('disconnect', (e) => { if (e.device === usbDev) { usbDev = null; pendingUsb = null; paper = null; logEvent('print_fail', 'Câble USB débranché ou imprimante éteinte'); render(); } });
    navigator.usb?.addEventListener('connect', () => reconnect().then(sync));
    setInterval(async () => { if (linked() && !running) paper = await readPaper(); render(); }, 30000);
    setInterval(loadRemote, 20000);
    setInterval(pollCommands, 20000);
    reconnect().then(() => { keepAwake(); render(); });
  }
  init();

  // Called by admin.js once the admin is logged in.
  let opened = false;
  function onLogin() {
    if (opened) return; opened = true;
    if (!isPhone) { if (location.hash === '#imprimante') document.querySelector('[data-tab="printer"]')?.click(); return; }   // a computer only follows the phone
    logEvent('page_open', `${cfg.name} · ${navigator.userAgent.slice(0, 100)}`); report(true);
    let closedBefore = false; try { closedBefore = !!sessionStorage.getItem('kc-wz-closed'); } catch {}
    if (location.hash === '#imprimante' || (!cfg.mode && !closedBefore)) openWizard();
  }

  return { sync, on: active, badge, printOne, render, loadRemote, onLogin, openWizard, _poll: pollCommands, _ticket: ticket, _escpos: escpos, _draw: draw, _testTicket: testTicket };
})();
