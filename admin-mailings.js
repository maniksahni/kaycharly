'use strict';
// Kay Charly · customer emails from the admin.
//   • Menu tab: "📣 Envoyer le menu aux clients" — preview (exact email + who receives it), then send.
//     After a change to a "Plats du jour" item, a reminder banner offers to send it.
//   • "⭐ Avis" tab: ratings customers left from the automatic "Comment était votre repas ?" email.
window.KCM = (() => {
  const el = (id) => document.getElementById(id);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = () => el('mailWhen').value;
  const clock = (t) => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const call = (body) => api('/functions/v1/customer-mailings', { method: 'POST', body: { message: el('mailMessage').value.trim(), ...body } });
  let preview = null;

  async function openPreview() {
    const btn = el('mailPreview'); btn.disabled = true; el('mailStatus').textContent = 'Préparation de l’aperçu…';
    try {
      preview = await call({ action: 'menu', when: when(), preview: true });
      el('mailFrame').srcdoc = preview.html;
      const n = preview.recipients.length;
      el('mailWho').innerHTML = n
        ? `<b>${n} client${n > 1 ? 's' : ''}</b> recevr${n > 1 ? 'ont' : 'a'} cet e-mail : <span class="muted">${preview.recipients.map(h).join(', ')}</span>`
        : '<b>Aucun client à prévenir pour l’instant</b> (les clients apparaissent ici après leur première commande).';
      el('mailLast').textContent = preview.update
        ? `Un menu a déjà été envoyé à ${clock(preview.last.created_at)} : celui-ci partira comme « 🔄 Mise à jour » avec le menu modifié.`
        : preview.last ? `Dernier envoi : ${clock(preview.last.created_at)} (${preview.last.sent} e-mails).` : 'Aucun menu envoyé pour l’instant.';
      el('mailSend').disabled = !n;
      el('mailSend').textContent = n ? `${preview.update ? '🔄 Envoyer la mise à jour' : '📣 Envoyer'} à ${n} client${n > 1 ? 's' : ''}` : 'Envoyer';
      el('mailSubject').textContent = preview.subject;
      el('mailDialog').showModal();
      el('mailStatus').textContent = '';
    } catch (e) { el('mailStatus').textContent = 'Aperçu impossible : ' + e.message; }
    btn.disabled = false;
  }

  async function send(force = false) {
    const btn = el('mailSend'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const r = await call({ action: 'menu', when: when(), force });
      el('mailDialog').close();
      el('mailStatus').textContent = `✓ Menu envoyé à ${r.sent} client${r.sent > 1 ? 's' : ''}${r.failed ? ` (${r.failed} échec${r.failed > 1 ? 's' : ''})` : ''}.`;
      el('menuChanged').hidden = true;
    } catch (e) {
      if (/moins de 2 minutes/.test(e.message) && confirm('Ce menu vient d’être envoyé. Le renvoyer quand même ?')) return send(true);
      el('mailStatus').textContent = 'Envoi impossible : ' + e.message;
      btn.disabled = false; btn.textContent = 'Réessayer l’envoi';
    }
  }

  // A daily-menu change: suggest sending it (never sent automatically, so small edits do not spam customers).
  function menuChanged(item) {
    if (item && item.category !== 'Plats du jour') return;
    el('menuChanged').hidden = false;
  }

  // ---------- reviews ----------
  async function loadReviews() {
    const list = el('reviewList');
    try {
      const rows = await api('/rest/v1/kc_feedback?select=*&order=updated_at.desc&limit=300');
      const byRef = Object.fromEntries((typeof orders !== 'undefined' ? orders : []).map((o) => [o.reference, o]));
      const asked = (typeof orders !== 'undefined' ? orders : []).filter((o) => o.feedback_token && o.status !== 'Annulée').length;   // cancelled test orders do not count
      const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : 0;
      const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
      el('reviewSummary').innerHTML = rows.length
        ? `<strong>${avg.toFixed(1).replace('.', ',')} / 5</strong> <span class="stars">${stars(Math.round(avg))}</span><small>${rows.length} avis · ${asked} demande${asked > 1 ? 's' : ''} envoyée${asked > 1 ? 's' : ''}</small>`
          + `<div class="dist">${[5, 4, 3, 2, 1].map((n) => { const c = rows.filter((r) => r.rating === n).length; return `<span>${n}★</span><i style="--w:${rows.length ? Math.round(c / rows.length * 100) : 0}%"></i><span>${c}</span>`; }).join('')}</div>`
        : `<strong>Pas encore d’avis</strong><small>${asked} demande${asked > 1 ? 's' : ''} envoyée${asked > 1 ? 's' : ''}. Chaque client reçoit automatiquement « Comment était votre repas ? » 30 minutes après la fin du service.</small>`;
      list.innerHTML = rows.map((r) => {
        const o = byRef[r.order_reference];
        return `<article class="review ${r.rating <= 2 ? 'low' : ''}"><div><span class="stars">${stars(r.rating)}</span> <b>${h(o?.customer_name || 'Client')}</b> <span class="muted">· ${h(r.order_reference)} · ${clock(r.updated_at)}</span></div>`
          + (r.comment ? `<p>${h(r.comment)}</p>` : '<p class="muted">Pas de commentaire.</p>')
          + (o && r.rating <= 3 ? `<p class="muted">À rappeler ? <a href="tel:${h(o.phone)}">${h(o.phone)}</a> · <a href="mailto:${h(o.customer_email)}">${h(o.customer_email)}</a></p>` : '') + '</article>';
      }).join('') || '';
    } catch (e) { el('reviewSummary').textContent = 'Avis indisponibles : ' + e.message; }
  }

  el('mailPreview').onclick = openPreview;
  el('mailChangedSend').onclick = openPreview;
  el('mailSend').onclick = () => send(false);
  el('mailCancel').onclick = () => el('mailDialog').close();
  el('mailTest').onclick = async () => {
    const b = el('mailTest'); b.disabled = true;
    try { const r = await call({ action: 'menu', when: when(), test: true }); el('mailWho').insertAdjacentHTML('beforeend', `<br><b>✓ Test envoyé à ${h(r.to)}</b> : regardez votre boîte mail.`); }
    catch (e) { el('mailWho').insertAdjacentHTML('beforeend', `<br><span class="err">Test impossible : ${h(e.message)}</span>`); }
    b.disabled = false;
  };
  return { menuChanged, loadReviews, openPreview };
})();
