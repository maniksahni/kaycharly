// Kay Charly · Google Sheet des commandes
// À coller dans le Google Sheet : Extensions → Apps Script → remplacer tout le code → Enregistrer.
// Puis, dans Apps Script : Paramètres du projet (⚙️) → Propriétés du script → Ajouter :
//   SHEET_TOKEN = (la même valeur que le secret SHEET_TOKEN de Cloudflare)
// Puis, dans le Sheet : menu « Kay Charly » → « Activer la mise à jour automatique ».
//
// Onglets créés et tenus à jour toutes les 10 minutes (toutes les commandes depuis le début) :
//   • « Aujourd’hui » : commandes du jour, combien à préparer / prêtes / remises / livrées / à emporter / annulées.
//   • « Par jour »    : les mêmes chiffres jour par jour + chiffre d’affaires.
//   • « Commandes »   : une ligne par commande.
//   • « Clients »     : une ligne par client (contact, nombre de commandes, total dépensé, e-mails acceptés ou non).
//   • « Avis »        : les notes et commentaires laissés par les clients.
// Le Sheet ne fait que lire : rien n’est modifié sur le site.

const KC_URL = 'https://kaycharly.fr/functions/v1/customer-mailings';
const KC_DAYS = 3650;   // tout l’historique

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kay Charly')
    .addItem('Mettre à jour maintenant', 'synchroniser')
    .addItem('Activer la mise à jour automatique', 'installer')
    .addToUi();
}

// Une seule minuterie : toutes les 10 minutes.
function installer() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('synchroniser').timeBased().everyMinutes(10).create();
  synchroniser();
  SpreadsheetApp.getActive().toast('Mise à jour automatique activée (toutes les 10 minutes).', 'Kay Charly', 6);
}

function synchroniser() {
  const token = PropertiesService.getScriptProperties().getProperty('SHEET_TOKEN');
  if (!token) throw new Error('Ajoutez SHEET_TOKEN dans Apps Script → Paramètres du projet → Propriétés du script.');
  const res = UrlFetchApp.fetch(KC_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-sheet-token': token },
    payload: JSON.stringify({ action: 'sheet', days: KC_DAYS }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Site Kay Charly : ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  const orders = data.orders;
  const ss = SpreadsheetApp.getActive();
  const tz = 'Europe/Paris';
  const now = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // ---- Commandes ----
  const head = ['Date', 'Heure', 'Référence', 'Statut', 'Mode', 'Client', 'Téléphone', 'E-mail', 'Adresse', 'Plats', 'Total (€)', 'Paiement', 'Remarque'];
  const rows = orders.map((o) => [o.date, o.time, o.reference, o.status, o.mode, o.client, "'" + o.phone, o.email, o.address, o.items, o.total, o.payment || 'Espèces', o.note]);
  write_(ss, 'Commandes', [head].concat(rows), 'Mis à jour le ' + now + ' · ' + orders.length + ' commandes');

  // ---- Clients ----
  const clientHead = ['Client', 'Téléphone', 'E-mail', 'Adresse', 'Commandes', 'dont livraison', 'dont à emporter', 'Annulées', 'Total dépensé (€)', 'Première commande', 'Dernière commande', 'Accepte les e-mails'];
  const clientRows = (data.clients || []).map((c) => [c.client, "'" + c.phone, c.email, c.address, c.orders, c.delivery, c.pickup, c.cancelled, c.spent, c.first, c.last, c.emails]);
  write_(ss, 'Clients', [clientHead].concat(clientRows), 'Mis à jour le ' + now + ' · ' + clientRows.length + ' clients');

  // ---- Avis ----
  const reviews = data.reviews || [];
  const avg = reviews.length ? Math.round(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length * 10) / 10 : 0;
  const avisHead = ['Date', 'Heure', 'Note (1–5)', 'Étoiles', 'Commentaire', 'Client', 'Téléphone', 'E-mail', 'Commande'];
  const avisRows = reviews.map((r) => [r.date, r.time, r.rating, '★★★★★'.slice(0, r.rating) + '☆☆☆☆☆'.slice(0, 5 - r.rating), r.comment, r.client, "'" + r.phone, r.email, r.reference]);
  write_(ss, 'Avis', [avisHead].concat(avisRows), 'Mis à jour le ' + now + ' · ' + reviews.length + ' avis' + (reviews.length ? ' · moyenne ' + avg + ' / 5' : ''));

  // ---- Par jour ----
  const byDay = {};
  orders.forEach((o) => {
    const d = byDay[o.date] || (byDay[o.date] = { total: 0, nouvelles: 0, prep: 0, pretes: 0, remises: 0, livrees: 0, emporter: 0, annulees: 0, ca: 0 });
    d.total++;
    if (o.status === 'Annulée') { d.annulees++; return; }
    d.ca += o.total;
    if (o.status === 'Nouvelle') d.nouvelles++;
    if (o.status === 'En préparation') d.prep++;
    if (o.status === 'Prête') d.pretes++;
    if (o.status === 'Retirée') { d.remises++; if (o.mode === 'Livraison') d.livrees++; else d.emporter++; }
  });
  const dayHead = ['Jour', 'Commandes', 'Nouvelles', 'En préparation', 'Prêtes (faites)', 'Remises', 'dont livrées', 'dont à emporter', 'Annulées', 'Chiffre (€, hors annulées)'];
  const dayRows = Object.keys(byDay).sort().reverse().map((k) => { const d = byDay[k]; return [k, d.total, d.nouvelles, d.prep, d.pretes, d.remises, d.livrees, d.emporter, d.annulees, d.ca]; });
  write_(ss, 'Par jour', [dayHead].concat(dayRows), 'Mis à jour le ' + now);

  // ---- Aujourd’hui ----
  const t = byDay[today] || { total: 0, nouvelles: 0, prep: 0, pretes: 0, remises: 0, livrees: 0, emporter: 0, annulees: 0, ca: 0 };
  const todayOrders = orders.filter((o) => o.date === today);
  const modes = { Livraison: 0, 'À emporter': 0 };
  const pays = { 'Carte bleue': 0, 'Espèces': 0, 'Tickets restaurant': 0 };
  todayOrders.forEach((o) => { if (o.status !== 'Annulée') { modes[o.mode]++; pays[o.payment || 'Espèces'] = (pays[o.payment || 'Espèces'] || 0) + o.total; } });
  write_(ss, 'Aujourd’hui', [
    ['Aujourd’hui (' + today + ')', ''],
    ['Commandes reçues', t.total],
    ['À préparer (nouvelles)', t.nouvelles],
    ['En préparation', t.prep],
    ['Prêtes (faites)', t.pretes],
    ['Remises au client', t.remises],
    ['   dont livrées', t.livrees],
    ['   dont à emporter', t.emporter],
    ['Annulées', t.annulees],
    ['Commandes en livraison (hors annulées)', modes.Livraison],
    ['Commandes à emporter (hors annulées)', modes['À emporter']],
    ['Chiffre du jour (€, hors annulées)', t.ca],
    ['   dont carte bleue (€)', pays['Carte bleue']],
    ['   dont espèces (€)', pays['Espèces']],
    ['   dont tickets restaurant (€)', pays['Tickets restaurant']],
    ['Clients au total', (data.clients || []).length],
    ['Avis reçus (moyenne)', reviews.length + (reviews.length ? ' (' + avg + ' / 5)' : '')],
  ], 'Mis à jour le ' + now + ' · se met à jour toutes les 10 minutes');
}

// Rewrites a tab: data from row 3, a small "updated" line in row 1.
function write_(ss, name, values, note) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1).setValue(note).setFontColor('#65716a').setFontStyle('italic');
  if (!values.length) return;
  const width = Math.max.apply(null, values.map((r) => r.length));
  const grid = values.map((r) => r.concat(Array(width - r.length).fill('')));
  sh.getRange(3, 1, grid.length, width).setValues(grid);
  sh.getRange(3, 1, 1, width).setFontWeight('bold').setBackground('#1b4234').setFontColor('#ffffff');
  sh.setFrozenRows(3);
  sh.autoResizeColumns(1, width);
}
