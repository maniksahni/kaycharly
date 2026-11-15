'use strict';
// Dashboard shortcuts: each number at the top (and in « Aujourd'hui ») opens the matching list.
(() => {
  const $ = (s) => document.querySelector(s);
  const tab = (name) => document.querySelector(`nav [data-tab="${name}"]`)?.click();
  const set = (sel, value, ev = 'input') => { const e = $(sel); if (!e) return; e.value = value; e.dispatchEvent(new Event(ev, { bubbles: true })); };
  const show = (sel) => setTimeout(() => $(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  function orders(status) {
    tab('orders');
    set('#search', ''); set('#period', 'today'); set('#status', status || 'Tous les statuts');
    show('#orders');
  }
  function dishes() {
    tab('menu');
    set('#menuSearch', ''); set('#menuFilter', 'on', 'change');
    show('#dishes');
  }
  const targets = {
    orderCount: () => orders(),
    pendingCount: () => orders('Nouvelle'),
    revenue: () => orders(),
    menuCount: dishes,
    dsNew: () => orders('Nouvelle'),
    dsPrep: () => orders('En préparation'),
    dsReady: () => orders('Prête'),
    dsDone: () => orders('Retirée'),
    dsCancel: () => orders('Annulée'),
  };
  const hints = { orderCount: 'Voir les commandes du jour', pendingCount: 'Voir les commandes à préparer', revenue: 'Voir les commandes du jour', menuCount: 'Voir les plats disponibles',
    dsNew: 'Voir les commandes à préparer', dsPrep: 'Voir les commandes en préparation', dsReady: 'Voir les commandes prêtes', dsDone: 'Voir les commandes remises', dsCancel: 'Voir les commandes annulées' };
  for (const [id, go] of Object.entries(targets)) {
    const card = document.getElementById(id)?.closest('article, .ds-grid > div');
    if (!card) continue;
    card.classList.add('clickable');
    card.setAttribute('role', 'button'); card.tabIndex = 0; card.title = hints[id]; card.setAttribute('aria-label', hints[id]);
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }
})();
