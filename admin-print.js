'use strict';
// Kay Charly · automatic ticket printing for the admin page.
//
// Two ways to print, chosen once per computer in the "Imprimante" tab:
//   • computer printer ("browser"): uses the printer installed in Windows/macOS. Prints without any
//     window when Chrome/Edge is opened with --kiosk-printing (the "Kay Charly Caisse" shortcut).
//   • USB direct ("usb"): Chrome/Edge talks straight to the Brother QL over WebUSB and reads its real
//     status (roll, cover, errors). Only works when no Brother driver holds the printer.
//
// While the admin is open and logged in, every new "Nouvelle" order is printed once, a sound plays,
// and the order card shows "Imprimé à …". The tab lists live checks so the owner sees what is missing.

window.KCP = (() => {
  const CFG_KEY = 'kc-printer', DONE_KEY = 'kc-printed';
  const MAX_AGE = 12 * 3600 * 1000;           // never auto-print orders older than 12 h
  const BROTHER = 0x04f9;
  const ROLLS = { 29: [306, 6], 38: [413, 12], 50: [554, 12], 54: [590, 0], 62: [696, 12] }; // printable dots, right margin
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ---------- saved settings ----------
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch {}
  if (cfg.sound === undefined) cfg.sound = true;
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };

  // Order id -> time printed. 0 = order that already existed when printing was switched on.
  const readDone = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}') || {}; } catch { return {}; } };
  const saveDone = (d) => { try { localStorage.setItem(DONE_KEY, JSON.stringify(Object.fromEntries(Object.entries(d).slice(-1000)))); } catch {} };

  let device = null, epOut = 0, epIn = 0, pendingIn = null;
  let usbState = null;          // { ok, text } from the last status read
  let lastError = '';
  let needBaseline = !Object.keys(readDone()).length;
  let wakeLock = null;

  const active = () => cfg.mode === 'browser' || (cfg.mode === 'usb' && !!device);
  const isChromium = () => !!(navigator.userAgentData?.brands || []).some((b) => /Chrom|Edge/.test(b.brand)) || /Chrome\/|Edg\//.test(navigator.userAgent) && !/OPR\/|Firefox\//.test(navigator.userAgent);
  const isWindows = /Windows/i.test(navigator.userAgent);

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
    return L;
  }

  const SAMPLE = {
    created_at: new Date().toISOString(), reference: 'KC-TEST000000', customer_name: 'TICKET TEST', phone: '07 60 62 95 72',
    address: '12 rue de la Gare, 91540 Mennecy', pickup: 'Livraison · 10 h – 11 h 30', total: 2900, note: 'Ticket test : ne pas préparer',
    items: [{ name: 'Menu poisson', quantity: 1, price: 1500 }, { name: 'Boudin noir', quantity: 1, price: 900 }, { name: 'Royal Soda Ananas', quantity: 2, price: 250 }],
  };

  // Canvas drawing (preview + USB raster).
  function draw(lines, W) {
    const S = W / 696, sizes = { title: 64 * S, big: 44 * S, normal: 32 * S }, pad = 10 * S;
    const c = document.createElement('canvas'), x = c.getContext('2d');
    const font = (l) => `${l.bold || l.invert || l.size === 'title' ? '700' : '400'} ${sizes[l.size || 'normal']}px Arial,Helvetica,sans-serif`;
    const wrap = (t, w) => { const out = []; let line = ''; for (const word of String(t).split(/\s+/)) { const next = line ? line + ' ' + word : word; if (line && x.measureText(next).width > w) { out.push(line); line = word; } else line = next; } if (line) out.push(line); return out.length ? out : ['']; };
    const pass = (render) => {
      let y = 14 * S;
      for (const l of lines) {
        if (l.rule) { y += 12 * S; if (render) x.fillRect(pad, y, W - 2 * pad, 3 * S); y += 16 * S; continue; }
        x.font = font(l);
        const lh = sizes[l.size || 'normal'] * 1.3;
        if ('left' in l) {
          const pw = x.measureText(l.right).width;
          wrap(l.left, W - 2 * pad - pw - 24 * S).forEach((r, i) => {
            if (render) { x.textAlign = 'left'; x.fillText(r, pad, y + lh * 0.8); if (!i) { x.textAlign = 'right'; x.fillText(l.right, W - pad, y + lh * 0.8); } }
            y += lh;
          });
          y += 6 * S; continue;
        }
        for (const r of wrap(l.t, W - 2 * pad - (l.invert ? 40 * S : 0))) {
          if (l.invert && render) { x.fillRect(pad, y, W - 2 * pad, lh + 8 * S); x.fillStyle = '#fff'; }
          if (render) { x.textAlign = l.center ? 'center' : 'left'; x.fillText(r, l.center ? W / 2 : pad, y + lh * 0.8 + (l.invert ? 4 * S : 0)); x.fillStyle = '#000'; }
          y += lh + (l.invert ? 14 * S : 0);
        }
        y += 2 * S;
      }
      return Math.ceil(y + 20 * S);
    };
    c.width = W; c.height = 10; x.textBaseline = 'alphabetic';
    const H = pass(false); c.height = H;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#000'; pass(true);
    return c;
  }

  // ---------- printing through the computer's printer ----------
  function ticketHtml(lines) {
    return `<!doctype html><meta charset="utf-8"><style>@page{margin:2mm}body{font:13px/1.3 Arial,sans-serif;margin:0;width:58mm;color:#000}.c{text-align:center}.b{font-weight:700}.g{font-size:18px}.t{font-size:26px;font-weight:700}.r{display:flex;justify-content:space-between;gap:10px}hr{border:0;border-top:1px solid #000}p{margin:2px 0;overflow-wrap:anywhere}.i{background:#000;color:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact}</style>`
      + lines.map((l) => l.rule ? '<hr>' : `<p class="${l.center ? 'c ' : ''}${l.bold ? 'b ' : ''}${l.size === 'big' ? 'g ' : ''}${l.size === 'title' ? 't ' : ''}${l.invert ? 'i ' : ''}${'left' in l ? 'r' : ''}">${'left' in l ? `<span>${h(l.left)}</span><span>${h(l.right)}</span>` : h(l.t)}</p>`).join('');
  }

  // Resolves with how long print() blocked: a print window keeps it open, silent printing returns at once.
  function viaBrowser(lines) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      f.srcdoc = ticketHtml(lines);
      f.onload = () => {
        const t0 = performance.now();
        f.contentWindow.focus();
        f.contentWindow.print();
        const blocked = performance.now() - t0;
        setTimeout(() => f.remove(), 1500);
        resolve(blocked);
      };
      document.body.append(f);
    });
  }

  // ---------- printing straight to a Brother QL over USB ----------
  function raster(canvas, mm) {
    const [W, margin] = ROLLS[mm], hgt = canvas.height, img = canvas.getContext('2d').getImageData(0, 0, W, hgt).data, start = 720 - W - margin;
    const head = [...new Array(200).fill(0), 0x1b, 0x40, 0x1b, 0x69, 0x7a, 0xce, 0x0a, mm, 0, hgt & 255, hgt >> 8 & 255, hgt >> 16 & 255, hgt >>> 24, 0, 0, 0x1b, 0x69, 0x4d, 0x40, 0x1b, 0x69, 0x41, 1, 0x1b, 0x69, 0x4b, 0x08, 0x1b, 0x69, 0x64, 35, 0];
    const out = new Uint8Array(head.length + hgt * 93 + 1);
    out.set(head);
    let p = head.length;
    for (let y = 0; y < hgt; y++) {
      out.set([0x67, 0, 90], p); p += 3;
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (img[i] < 128) { const bit = 719 - (start + x); out[p + (bit >> 3)] |= 0x80 >> (bit & 7); } }
      p += 90;
    }
    out[p] = 0x1a;
    return out;
  }
  async function write(data) { for (let i = 0; i < data.length; i += 4096) await device.transferOut(epOut, data.slice(i, i + 4096)); }
  async function readStatus() {
    await write(new Uint8Array([...new Array(200).fill(0), 0x1b, 0x40, 0x1b, 0x69, 0x53]));
    const end = Date.now() + 2500;
    while (Date.now() < end) {
      pendingIn = pendingIn || device.transferIn(epIn, 32);
      const r = await Promise.race([pendingIn, sleep(300).then(() => null)]);
      if (!r) continue;
      pendingIn = null;
      if (r.data && r.data.byteLength >= 32) { const b = new Uint8Array(r.data.buffer, r.data.byteOffset, 32); if (b[18] === 0) return b; } else await sleep(100);
    }
    return null;
  }
  function checkStatus(b) {
    if (!b) throw Error('L’imprimante ne répond pas. Vérifiez qu’elle est allumée.');
    if (b[8] & 1 || b[9] & 1) throw Error('Aucun rouleau détecté.');
    if (b[8] & 2) throw Error('Rouleau terminé : remplacez le rouleau.');
    if (b[8] & 4) throw Error('Massicot bloqué.');
    if (b[9] & 0x10) throw Error('Capot ouvert : refermez le capot.');
    if (b[8] || b[9]) throw Error('Imprimante en erreur : éteignez-la puis rallumez-la.');
    if (b[11] === 0x0b) throw Error('Installez un rouleau continu (DK-22205, 62 mm).');
    if (!ROLLS[b[10]]) throw Error('Largeur de rouleau non prise en charge.');
    if (cfg.mm !== b[10]) { cfg.mm = b[10]; saveCfg(); }
  }
  async function probeUsb() {
    if (!device) { usbState = null; return; }
    try { checkStatus(await readStatus()); usbState = { ok: true, text: `Brother détectée · rouleau ${cfg.mm || 62} mm · prête` }; }
    catch (e) { usbState = { ok: false, text: e.message }; }
  }
  async function viaUsb(lines) {
    checkStatus(await readStatus());
    const mm = cfg.mm || 62;
    await write(raster(draw(lines, ROLLS[mm][0]), mm));
    await sleep(1500);
    usbState = { ok: true, text: `Brother détectée · rouleau ${mm} mm · prête` };
  }
  async function attach(d) {
    await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const itf = d.configuration.interfaces.find((i) => i.alternates[0].endpoints.some((e) => e.direction === 'out' && e.type === 'bulk'));
    if (!itf) throw Error('Désactivez le mode Editor Lite (voyant vert éteint).');
    const eps = itf.alternates[0].endpoints;
    await d.claimInterface(itf.interfaceNumber);
    epOut = eps.find((e) => e.direction === 'out' && e.type === 'bulk').endpointNumber;
    epIn = (eps.find((e) => e.direction === 'in' && e.type === 'bulk') || {}).endpointNumber;
    device = d; pendingIn = null;
  }
  async function reattach() {
    if (cfg.mode !== 'usb' || !navigator.usb) return;
    device = null; pendingIn = null;
    const d = (await navigator.usb.getDevices()).find((x) => x.vendorId === cfg.vendorId && x.productId === cfg.productId);
    if (d) try { await attach(d); } catch { device = null; }
    await probeUsb();
  }

  const send = (lines) => (cfg.mode === 'usb' ? viaUsb(lines) : viaBrowser(lines));

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

  // ---------- live checks shown in the tab ----------
  function checks() {
    const live = window.kcLastLoad && Date.now() - window.kcLastLoad < 60000;
    const list = [];
    list.push(isChromium()
      ? { ok: true, label: 'Navigateur', text: 'Google Chrome / Microsoft Edge' }
      : { ok: false, label: 'Navigateur', text: 'Ouvrez cette page avec Google Chrome (ou Microsoft Edge).' });
    list.push(live
      ? { ok: true, label: 'Commandes en direct', text: 'Connecté · vérification toutes les 15 secondes' }
      : { ok: false, label: 'Commandes en direct', text: 'Pas de connexion récente. Vérifiez internet puis cliquez sur Actualiser.' });
    if (!cfg.mode) {
      list.push({ ok: false, label: 'Imprimante', text: 'Aucune imprimante choisie : cliquez sur « Imprimante de l’ordinateur » ci-dessous.' });
    } else if (cfg.mode === 'usb') {
      list.push(device && usbState?.ok
        ? { ok: true, label: 'Imprimante (USB direct)', text: usbState.text }
        : { ok: false, label: 'Imprimante (USB direct)', text: device ? usbState?.text || 'Lecture de l’état…' : 'Imprimante débranchée ou éteinte. Rebranchez-la puis cliquez sur « Revérifier ».' });
    } else {
      list.push(cfg.confirmedAt
        ? { ok: true, label: 'Imprimante de l’ordinateur', text: `Ticket test sorti le ${clock(cfg.confirmedAt)}` }
        : { ok: false, label: 'Imprimante de l’ordinateur', text: 'Pas encore confirmée : imprimez un ticket test.' });
      list.push(cfg.silent === true
        ? { ok: true, label: 'Impression sans fenêtre', text: 'Les tickets sortent tout seuls, sans cliquer.' }
        : { ok: false, label: 'Impression sans fenêtre', text: cfg.silent === false ? 'Une fenêtre d’impression s’ouvre : ouvrez l’admin avec le raccourci « Kay Charly Caisse » (voir Les étapes, plus bas).' : 'Pas encore vérifiée : imprimez un ticket test.' });
    }
    list.push(wakeLock
      ? { ok: true, label: 'Écran', text: 'Reste allumé tant que cette page est ouverte' }
      : { ok: false, warn: true, label: 'Écran', text: document.hidden ? 'Page cachée : gardez cet onglet devant les autres.' : 'Mise en veille possible : réglez la mise en veille de l’ordinateur sur « Jamais ».' });
    list.push({ ok: cfg.sound, warn: !cfg.sound, label: 'Son des nouvelles commandes', text: cfg.sound ? 'Activé' : 'Coupé' });
    if (lastError) list.push({ ok: false, label: 'Dernière impression', text: lastError });
    return list;
  }

  function render() {
    const bar = $('printerBar'), list = $('printerChecks');
    if (!bar) return;
    const all = checks(), blocking = all.filter((c) => !c.ok && !c.warn);
    const ready = active() && !blocking.length;
    bar.dataset.state = ready ? 'on' : 'off';
    $('printerState').textContent = ready
      ? 'Impression automatique prête : chaque nouvelle commande s’imprime toute seule.'
      : !cfg.mode ? 'Impression automatique désactivée : choisissez l’imprimante dans l’onglet Imprimante.'
      : 'Impression automatique à vérifier : ' + blocking[0].text;
    list.innerHTML = all.map((c) => `<li class="${c.ok ? 'ok' : c.warn ? 'warn' : 'ko'}"><span>${c.ok ? '✓' : c.warn ? '!' : '✕'}</span><div><b>${h(c.label)}</b><small>${h(c.text)}</small></div></li>`).join('');
    $('printerMode').textContent = cfg.mode === 'usb' ? 'USB direct (Brother)' : cfg.mode === 'browser' ? 'Imprimante de l’ordinateur' : 'Aucune';
    $('printerSound').textContent = cfg.sound ? '🔔 Son : activé' : '🔕 Son : coupé';
    $('printerOff').hidden = !cfg.mode;
    $('printerTest').disabled = !cfg.mode;
    $('stepsWin').hidden = !isWindows; $('stepsMac').hidden = isWindows;
  }

  // ---------- printing new orders ----------
  async function run() {
    if (!window.kcLastLoad) return;               // wait until orders have really loaded
    const done = readDone();
    if (needBaseline) { orders.forEach((o) => { done[o.id] ??= 0; }); saveDone(done); needBaseline = false; renderOrders(); return; }
    const now = Date.now();
    const todo = orders.filter((o) => o.status === 'Nouvelle' && !(o.id in done) && now - new Date(o.created_at) < MAX_AGE).reverse();
    if (todo.length) chime();
    for (const o of todo) {
      try {
        await send(ticket(o));
        done[o.id] = Date.now(); saveDone(done); lastError = '';
      } catch (e) {
        if (['NetworkError', 'InvalidStateError', 'NotFoundError'].includes(e.name)) await reattach();
        lastError = `${o.reference} : ${e.message} Nouvel essai automatique dans 15 secondes.`;
        break;
      } finally { renderOrders(); render(); }
    }
  }
  let running = false;
  async function sync() {
    render();
    if (!active() || running) return;
    running = true;
    try {
      if (navigator.locks) await navigator.locks.request('kc-print', { ifAvailable: true }, (l) => (l ? run() : null));
      else await run();
    } finally { running = false; }
  }

  async function printOne(id) {
    const o = orders.find((x) => String(x.id) === String(id));
    if (!o) return;
    if (!active()) { KCReceipt.show(o, true); return; }   // no printer set up: open the receipt with the print window
    try { await send(ticket(o)); const done = readDone(); done[o.id] = Date.now(); saveDone(done); lastError = ''; }
    catch (e) { lastError = `${o.reference} : ${e.message}`; }
    renderOrders(); render();
  }

  function badge(o) {
    const t = readDone()[o.id];
    if (t) return `<span class="print-ok">Imprimé à ${new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}</span>`;
    return t === undefined && o.status === 'Nouvelle' && active() ? '<span class="print-wait">Impression en attente</span>' : '';
  }

  // ---------- buttons in the tab ----------
  function chooseBrowser() {
    cfg = { ...cfg, mode: 'browser', silent: undefined, confirmedAt: undefined };
    saveCfg(); needBaseline = true; keepAwake(); sync(); test();
  }
  async function chooseUsb() {
    if (!navigator.usb) { lastError = 'Le mode USB direct demande Google Chrome ou Microsoft Edge.'; render(); return; }
    try {
      const d = await navigator.usb.requestDevice({ filters: [{ vendorId: BROTHER }] });
      await attach(d);
      cfg = { ...cfg, mode: 'usb', vendorId: d.vendorId, productId: d.productId, mm: 62 };
      saveCfg(); needBaseline = true; await probeUsb(); keepAwake(); sync(); test();
    } catch (e) {
      if (e.name === 'NotFoundError') return;  // owner closed the list
      lastError = e.name === 'SecurityError' || /access denied|claim/i.test(e.message)
        ? 'Windows utilise déjà le pilote Brother pour cette imprimante : choisissez plutôt « Imprimante de l’ordinateur ».'
        : 'Connexion USB impossible : ' + e.message;
      render();
    }
  }
  async function test() {
    if (!cfg.mode) return;
    lastError = '';
    $('testAsk').hidden = true;
    try {
      const blocked = await send(ticket({ ...SAMPLE, created_at: new Date().toISOString() }));
      if (cfg.mode === 'browser') { cfg.silent = blocked < 1200; saveCfg(); }
      $('testAsk').hidden = false;
    } catch (e) { lastError = 'Test impossible : ' + e.message; }
    render();
  }
  function answer(ok) {
    $('testAsk').hidden = true;
    if (ok) { cfg.confirmedAt = Date.now(); lastError = ''; }
    else { cfg.confirmedAt = undefined; lastError = 'Le ticket test n’est pas sorti : vérifiez câble, alimentation, rouleau et imprimante par défaut (voir Les étapes), puis réessayez.'; }
    saveCfg(); render();
  }
  async function recheck() { if (cfg.mode === 'usb') await reattach(); await window.kcReload?.(); render(); }
  async function turnOff() {
    if (!confirm('Arrêter l’impression automatique sur cet ordinateur ?')) return;
    try { await device?.close(); } catch {}
    device = null; usbState = null; cfg = { sound: cfg.sound }; saveCfg(); render(); renderOrders();
  }
  function preview() { $('printerPreviewBox').replaceChildren(draw(ticket(SAMPLE), ROLLS[cfg.mm || 62][0])); $('printerPreview').showModal(); }

  function init() {
    $('printerBrowser').onclick = chooseBrowser;
    $('printerUsb').onclick = chooseUsb;
    $('printerTest').onclick = test;
    $('testYes').onclick = () => answer(true);
    $('testNo').onclick = () => answer(false);
    $('printerRecheck').onclick = recheck;
    $('printerOff').onclick = turnOff;
    $('printerShow').onclick = preview;
    $('printerClose').onclick = () => $('printerPreview').close();
    $('printerSound').onclick = () => { cfg.sound = !cfg.sound; saveCfg(); if (cfg.sound) chime(); render(); };
    $('copyCmd').onclick = () => navigator.clipboard?.writeText($('shortcutCmd').textContent).then(() => { $('copyCmd').textContent = 'Copié ✓'; });
    $('printerGo').onclick = () => document.querySelector('[data-tab="printer"]').click();
    document.addEventListener('visibilitychange', () => { keepAwake(); render(); });
    if (navigator.usb) {
      navigator.usb.addEventListener('disconnect', (e) => { if (e.device === device) { device = null; pendingIn = null; usbState = null; render(); } });
      navigator.usb.addEventListener('connect', async () => { await reattach(); render(); sync(); });
    }
    setInterval(async () => { if (cfg.mode === 'usb' && device && !running) await probeUsb(); render(); }, 30000);
    reattach().then(() => { keepAwake(); render(); });
  }
  init();

  return { sync, on: active, badge, printOne, render, _ticket: ticket };
})();
