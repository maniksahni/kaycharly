// Kay Charly · Google Sheet des commandes
// À coller dans le Google Sheet : Extensions → Apps Script → remplacer tout le code → Enregistrer.
// Puis, dans Apps Script : Paramètres du projet (⚙️) → Propriétés du script → Ajouter :
//   SHEET_TOKEN = (la même valeur que le secret SHEET_TOKEN de Supabase)
// Puis, dans le Sheet : menu « Kay Charly » → « Activer la mise à jour automatique ».
//
// Onglets créés et tenus à jour toutes les 10 minutes (90 derniers jours) :
//   • « Aujourd’hui » : commandes du jour, combien à préparer / prêtes / remises / livrées / à emporter / annulées.
//   • « Par jour »    : les mêmes chiffres jour par jour + chiffre d’affaires.
//   • « Commandes »   : une ligne par commande.
// Le Sheet ne fait que lire : rien n’est modifié sur le site.

const KC_URL = 'https://bqtsczpszczikonpdtlo.supabase.co/functions/v1/customer-mailings';
const KC_DAYS = 90;

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
  const orders = JSON.parse(res.getContentText()).orders;
  const ss = SpreadsheetApp.getActive();
  const tz = 'Europe/Paris';
  const now = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // ---- Commandes ----
  const head = ['Date', 'Heure', 'Référence', 'Statut', 'Mode', 'Client', 'Téléphone', 'E-mail', 'Adresse', 'Plats', 'Total (€)', 'Remarque'];
  const rows = orders.map((o) => [o.date, o.time, o.reference, o.status, o.mode, o.client, "'" + o.phone, o.email, o.address, o.items, o.total, o.note]);
  write_(ss, 'Commandes', [head].concat(rows), 'Mis à jour le ' + now + ' · ' + orders.length + ' commandes (' + KC_DAYS + ' derniers jours)');

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
  todayOrders.forEach((o) => { if (o.status !== 'Annulée') modes[o.mode]++; });
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
