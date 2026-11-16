'use strict';
// « Commande sur place »: the owner takes the order of a customer who is in the restaurant, from the admin
// (usually the restaurant phone), then the receipt prints straight away.
// Only dishes that are available in the admin are offered; prices are checked again by the server.
window.KCC = (() => {
  const $ = (id) => document.getElementById(id);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (c) => (Number(c) / 100).toFixed(2).replace('.', ',') + ' €';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cart = new Map();          // dish id -> quantity
  const PAY = { cb: 'Carte bleue', especes: 'Espèces', tr: 'Tickets restaurant' };
  let pay = '', mode = 'surplace', requestId = crypto.randomUUID(), sending = false, last = null;

  const dishes = () => (typeof menu !== 'undefined' ? menu : []).filter((d) => d.available && d.price > 0 && d.category !== 'Hors carte');
  const byId = () => Object.fromEntries(dishes().map((d) => [String(d.id), d]));
  const count = () => [...cart.values()].reduce((a, q) => a + q, 0);
  const total = () => { const m = byId(); return [...cart].reduce((a, [id, q]) => a + (m[id]?.price || 0) * q, 0); };

  // A dish switched off in the admin leaves the basket.
  function prune() { const m = byId(); let gone = 0; for (const id of [...cart.keys()]) if (!m[id]) { cart.delete(id); gone++; } return gone; }

  function renderMenu() {
    const q = norm($('ccSearch').value).trim();
    const groups = new Map();
    for (const d of dishes()) {
      if (q && !norm(d.name + ' ' + d.category + ' ' + (d.description || '')).includes(q)) continue;
      if (!groups.has(d.category)) groups.set(d.category, []);
      groups.get(d.category).push(d);
    }
    $('ccMenu').innerHTML = groups.size ? [...groups].map(([cat, list]) => `<div class="cc-cat"><h3>${h(cat)}</h3>${list.map((d) => {
      const n = cart.get(String(d.id)) || 0;
      return `<div class="cc-item${n ? ' on' : ''}" data-id="${h(d.id)}"><button type="button" class="cc-add" data-act="add" aria-label="Ajouter ${h(d.name)}"><b>${h(d.name)}</b>${d.description ? `<small>${h(d.description)}</small>` : ''}<span>${eur(d.price)}</span></button>`
        + `<div class="cc-step"><button type="button" data-act="minus" aria-label="Retirer un ${h(d.name)}"${n ? '' : ' disabled'}>−</button><output>${n}</output><button type="button" data-act="add" aria-label="Ajouter un ${h(d.name)}">+</button></div></div>`;
    }).join('')}</div>`).join('') : `<p class="muted">${dishes().length ? 'Aucun plat ne correspond.' : 'Aucun plat disponible : activez des plats dans « Carte & plats du jour ».'}</p>`;
  }

  function renderCart() {
    const m = byId(), n = count();
    $('ccCart').innerHTML = n ? [...cart].map(([id, q]) => `<li><span>${q} × ${h(m[id]?.name)}</span><b>${eur((m[id]?.price || 0) * q)}</b></li>`).join('') : '<li class="muted">Aucun plat choisi pour l’instant.</li>';
    $('ccCount').textContent = n ? `${n} article${n > 1 ? 's' : ''}` : 'Panier vide';
    $('ccTotal').textContent = eur(total());
    $('ccSend').disabled = !n || sending;
    $('ccClear').hidden = !n;
  }
  const render = () => { renderMenu(); renderCart(); };

  function setPay(p) {
    pay = p;
    document.querySelectorAll('[data-ccpay]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ccpay === p)));
    $('ccPay').classList.remove('missing'); say('');
  }
  function setMode(m) {
    mode = m;
    document.querySelectorAll('[data-ccmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ccmode === m)));
  }

  function say(text, bad) { const e = $('ccMsg'); e.textContent = text; e.classList.toggle('bad', !!bad); }

  function reset() {
    cart.clear(); requestId = crypto.randomUUID(); last = null;
    $('ccSearch').value = ''; setMode('surplace'); setPay(''); say('');
    $('ccDone').hidden = true; $('ccForm').hidden = false;
    render(); window.scrollTo({ top: $('counter').offsetTop - 10, behavior: 'smooth' });
  }

  // The admin reloads every 15 s; wait for the new order to be in the list before printing it.
  async function findOrder(reference) {
    for (let i = 0; i < 8; i++) {
      await window.kcReload?.();
      const o = (typeof orders !== 'undefined' ? orders : []).find((x) => x.reference === reference);
      if (o) return o;
      await new Promise((r) => setTimeout(r, 700));
    }
    return null;
  }
  async function print(o) {
    if (!o) return 'Commande enregistrée, mais le reçu n’a pas pu être ouvert : retrouvez-la dans « Commandes » (bouton Reçu).';
    if (window.KCP?.on?.()) { await window.KCP.printOne(o.id); return window.KCP.badge(o).includes('Imprimé') ? '🖨️ Ticket imprimé.' : '⚠️ Le ticket n’est pas sorti : vérifiez l’imprimante, puis « Réimprimer le reçu ».'; }
    window.KCReceipt?.show(o, true);   // no printer connected on this device: receipt view with the print window
    return '🧾 Reçu ouvert pour impression.';
  }

  async function send() {
    if (sending || !count()) return;
    if (!PAY[pay]) { $('ccPay').classList.add('missing'); $('ccPay').scrollIntoView({ behavior: 'smooth', block: 'center' }); say('Choisissez le paiement : carte bleue, espèces ou tickets restaurant.', true); return; }
    sending = true; renderCart(); say('Enregistrement de la commande…');
    try {
      const r = await KC.api('/rest/v1/rpc/kc_place_counter_order', { token: await token(), method: 'POST', body: {
        p_request_id: requestId, p_mode: mode, p_payment: pay, p_items: [...cart].map(([id, quantity]) => ({ id, quantity })) } });
      say('Commande enregistrée, impression du reçu…');
      const o = await findOrder(r.reference);
      last = o;
      const printed = await print(o);
      $('ccDoneTitle').textContent = `Commande ${r.reference} enregistrée`;
      $('ccDoneText').textContent = `${eur(r.total)} · ${mode === 'emporter' ? 'à emporter' : 'sur place'} · ${PAY[pay]}`;
      $('ccDonePrint').textContent = printed;
      $('ccForm').hidden = true; $('ccDone').hidden = false; say('');
      $('ccDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      const msg = e.message || 'Connexion impossible';
      if (/indisponible/i.test(msg)) {   // a dish was switched off meanwhile: refresh the menu and drop it
        await window.kcReload?.(); const gone = prune(); render();
        say(gone ? `${gone} plat${gone > 1 ? 's' : ''} n’étai${gone > 1 ? 'ent' : 't'} plus disponible${gone > 1 ? 's' : ''} : retiré${gone > 1 ? 's' : ''} du panier. Vérifiez puis validez à nouveau.` : msg, true);
      } else say(msg + ' · Réessayez : la commande ne sera pas enregistrée deux fois.', true);
    } finally { sending = false; renderCart(); }
  }

  function bind() {
    $('ccMenu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('.cc-item').dataset.id, n = cart.get(id) || 0;
      if (b.dataset.act === 'add') cart.set(id, Math.min(50, n + 1)); else if (n > 1) cart.set(id, n - 1); else cart.delete(id);
      say(''); render();
    });
    $('ccSearch').addEventListener('input', renderMenu);
    document.querySelectorAll('[data-ccmode]').forEach((b) => { b.onclick = () => setMode(b.dataset.ccmode); });
    document.querySelectorAll('[data-ccpay]').forEach((b) => { b.onclick = () => setPay(b.dataset.ccpay); });
    $('ccClear').onclick = () => { if (confirm('Vider le panier ?')) { cart.clear(); say(''); render(); } };
    $('ccSend').onclick = send;
    $('ccNew').onclick = reset;
    $('ccReprint').onclick = async () => { if (last) $('ccDonePrint').textContent = await print(last); };
  }

  // Called when the tab opens: fresh menu (availability may have changed), then draw.
  async function open() { await window.kcReload?.(); prune(); render(); }
  // Every admin refresh (15 s, or after a dish is switched on/off here): the list follows the menu at once.
  function refresh() {
    if (!$('ccMenu') || $('counter').hidden || sending) return;
    const gone = prune(); render();
    if (gone) say(`${gone} plat${gone > 1 ? 's' : ''} retiré${gone > 1 ? 's' : ''} du panier : plus disponible${gone > 1 ? 's' : ''}.`, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
  return { open, render, refresh };
})();
