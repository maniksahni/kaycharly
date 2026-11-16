# Kay Charly

Restaurant site with online ordering and an administration page, at **https://kaycharly.fr**.

Everything runs on one Cloudflare account. Brevo sends the emails.

- **Worker `kaycharly`** (`worker/index.js`, `wrangler.jsonc`): serves the pages (repository root; `.assetsignore` hides the server files) and the API the pages call (`/rest/v1`, `/auth/v1`, `/functions/v1`, `/storage/v1`). GitHub `main` deploys it automatically (Workers Builds).
- **D1 database `kaycharly`** (`worker/schema.sql`; the Worker creates the tables itself): menu, orders, email preferences, reviews, mailings and printer status/events.
- **KV `kaycharly-photos`**: menu photos uploaded from the admin.
- **Cron, every 10 minutes**: « Comment était votre repas ? » emails and the unprinted-order alert.
- **Secrets** (Cloudflare → Worker → Settings → Variables and Secrets):
  - `ADMIN_PASSWORD`: the admin login.
  - `BREVO_API_KEY`: an `xkeysib-` API key with only the "Transactional emails" permission.
  - `SHEET_TOKEN`: the Google Sheet token.
- **Vars** (`wrangler.jsonc`): `SITE_ORIGIN`, `OWNER_EMAIL`, `SENDER_EMAIL`.

Old addresses send visitors to kaycharly.fr (`backend.js`) with the page, its token and #hash kept: GitHub Pages, Cloudflare Pages, www, workers.dev and plain http. Old email links (avis, désinscription) keep working.

## Pages

- `index.html`: the storefront.
  - Live menu with category filters, cart, and takeaway or delivery checkout.
  - If the menu cannot load, it asks visitors to call.
  - Items in the « Hors carte » category stay in the admin but are not shown on the site.
- `admin.html`, `admin.js`, `admin.css`: the administration page.
  - Orders, with status changes and the day summary with CSV export.
  - Menu and daily dishes, prices, photos and availability.
  - Menu email, reviews and printer.
- `admin-print.js`: automatic printing from the restaurant's Android phone.
- `admin-receipt.js`: the 80 mm receipt.
- `admin-mailings.js`: the menu email.
- `avis.html` (rating) and `desinscription.html` (unsubscribe), opened from the emails.

## Admin access

There is one password, the secret `ADMIN_PASSWORD`. A login gives a 1-hour access token, renewed automatically for up to 400 days. Failed logins are limited to 10 per 15 minutes per IP. Changing the secret logs everyone out.

## Orders

Checkout calls `rpc/kc_place_order_with_email`. The Worker checks the order:

- It validates quantities and availability.
- It reads the current prices, calculates the total (1000 € at most) and issues the reference.
- It allows 3 orders per 5 minutes per phone.
- A request id stops duplicates after a network retry.

Customers cannot read orders. Payment is cash at handoff. Delivery is free.

The admin loads the 500 latest orders and refreshes every 15 seconds. Times and daily totals use Europe/Paris.

## Dashboard shortcuts

Every number at the top of the admin is clickable, and so is every box in « Aujourd'hui ». Each opens the matching list.

| Click | Opens |
|---|---|
| Commandes du jour, Total du jour | Today's orders |
| À préparer | Today's « Nouvelle » orders |
| Plats disponibles | The available dishes |
| En préparation / Prêtes / Remises / Annulées boxes | Today's orders with that status |

« 📊 Google Sheet » opens the owner's Sheet. The Sheet is private to the kaycharly37 Google account.

## Commande sur place (in the shop)

Admin → « 🧾 Commande sur place » is for a customer standing in the restaurant. It has a gold button at the top and a tab.

- The owner taps the dishes, which are only those available in the admin. They choose « Sur place » or « À emporter », then « Valider et imprimer ».
- There is no name, phone or e-mail. Every order still gets its own reference `KC-…`.
- The Worker (`rpc/kc_place_counter_order`, admin only) checks availability and sets the prices. A double tap gives the same order.
- The order is saved « En préparation », and no e-mail is sent.
- One ticket prints right away: the customer's receipt, with the order number, dishes, prices, total and « Merci ».
- Without a connected printer, the print window opens instead.
- It appears in Commandes, the day summary and the Google Sheet like any order. The ticket header says « SUR PLACE » or « À EMPORTER ».

## Payment mode

There is no online payment; customers pay at handoff. They choose one of three modes:
- 💳 Carte bleue
- 💶 Espèces
- 🎟️ Tickets restaurant

The site says « On accepte les tickets restaurant » in the hero, the info box, the menu footnote and the checkout.

- **Checkout:** a choice is required. The Worker stores the mode in `kc_orders.payment` and accepts only `cb`, `especes` or `tr`. A page loaded before this option existed sends no mode; that order is accepted and shown as « Espèces ».
- **Commande sur place:** the owner taps the mode before « Valider ».
- **Where the mode shows:**
  - the admin order cards;
  - « À encaisser aujourd'hui » (today's total per mode);
  - the printed ticket, in big letters (« À RÉGLER : TICKETS RESTAURANT »);
  - the receipt;
  - the customer email, the owner email and the PDF;
  - the CSV;
  - the Google Sheet: a « Paiement » column, plus a per-mode total in « Aujourd'hui ».
- **Older orders:** the column was added by `ensureSchema` with `ALTER TABLE`. Orders from before it have no mode and show as « Espèces ».

## Order emails

Right after each order, `functions/v1/order-notifications` sends two French emails through Brevo from `kaycharly37@gmail.com`:

- **Customer**: confirmation with the items, total and pickup/delivery details.
- **Owner** (`kaycharly91750@gmail.com`): the receipt, the client's details, an « Imprimer le reçu » button and the receipt as an 80 mm PDF.

`notified_at` on the order shows that the emails were sent. If sending fails, the order is still saved. Brevo → Transactional → Logs lists every email.

## Automatic printing

The printer is an 80 mm thermal ESC/POS printer (Tasofac, Bluetooth + USB, auto-cutter). It prints 72 mm wide, so the ticket is an image 576 dots wide.

Printing works only from the restaurant's Android phone (Chrome), on `https://kaycharly.fr/admin.html`. One button tries three methods in this order:

1. **Bluetooth appairé** (Web Serial, SPP). The printer is paired once in Android settings. This is how the restaurant's printer works.
2. **Bluetooth sans appairage** (BLE).
3. **USB with an OTG adapter.**

New orders print while the page is open. The screen stays on. When the page comes back to the front, missed orders print and the printer reconnects.

The phone reports its state to `kc_printer_status` and `kc_printer_events`. Any logged-in admin can see this under « Suivi à distance » and can ask the phone for a test ticket. On a computer, the tab only shows this follow-up.

If a « Nouvelle » order is more than 10 minutes old and has not printed, the cron emails the owner once.

## Customer emails

- **Menu du jour**: admin → Carte → « 📣 Envoyer le menu aux clients ». You get a preview, the recipient list and a test send first. Nothing is sent automatically.
- **« Comment était votre repas ? »**: sent by the cron, once per order, after the service ends:
  - delivery: 12h00;
  - pickup: 14h30, or 21h30 for the evening.

  Cancelled orders, archived orders and orders older than 3 days are skipped. Ratings appear in admin → « ⭐ Avis clients ».
- **Unsubscribe**: every email links to `desinscription.html`. Checkout has an opt-out box.

## Day summary, export and Google Sheet

- **Admin « Aujourd'hui »**: today's orders by status and a 7-day table. It also has a CSV export of every loaded order.
- **Google Sheet** « Kay Charly – Commandes » (`google-sheet/KayCharly.gs`): an Apps Script in the Sheet.
  - It reads `functions/v1/customer-mailings` with `{"action":"sheet"}` and the `x-sheet-token` header. The token is the script property `SHEET_TOKEN`, with the same value as the Cloudflare secret.
  - Every 10 minutes it rewrites five tabs: Commandes, Clients, Avis, Par jour and Aujourd'hui.
  - It only reads.

## Search engines and AI assistants (SEO / GEO)

- **`index.html` `<head>`**:
  - title, description and canonical (`https://kaycharly.fr/`);
  - Open Graph image `img/og-kay-charly.jpg`, favicon and app icons;
  - geo tags;
  - `Restaurant` schema.org data: address, GPS, phone, hours, delivery towns, cuisine, order action and social profiles.
- **The Worker adds the live menu** (`Menu`, with sections, dishes, prices and today's availability) to the home page.
- **`/llms.txt`** is a plain-text summary with the same live menu, for AI assistants.
- **`robots.txt`** allows everything public and blocks the admin, avis, désinscription and API pages. It points to `sitemap.xml`. The admin page is also `noindex`.
- **Google Search Console** (kaycharly37 account): URL-prefix property `https://kaycharly.fr/`.
  - It is verified by `google19042a54e91f046e.html` and the `google-site-verification` meta tag. Keep both.
  - The sitemap is submitted there, and indexing of the home page was requested.
- **Bing / IndexNow**: the key file `2e6886758f29801ae9fe127564952ba3.txt` lets us notify Bing and Yandex of changes (POST to `api.indexnow.org/indexnow`). ChatGPT search uses Bing.

## Checking things in Cloudflare

D1 → kaycharly → Console accepts single-line SQL; use only `select` queries. For example, the 10 latest orders:

```sql
select reference, created_at, status, customer_name, phone, total/100.0 as euros, notified_at from kc_orders order by created_at desc limit 10;
```

Times are UTC; Paris is UTC+1 in winter. Errors are under Worker → Observability → Events. D1 → Time Travel can restore the database to any minute of the last 30 days.

## Local test

```bash
npx wrangler dev --local --port 8787
```

The local `.dev.vars` file (git-ignored) holds test values for `ADMIN_PASSWORD` and `SHEET_TOKEN`. The printer tests are in `_test/printer.html`.
