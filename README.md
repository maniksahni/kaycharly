# Kay Charly

Static restaurant storefront with authenticated administration.

**Moving to Cloudflare (in progress).** `worker/index.js` + `wrangler.jsonc` run the whole site on one free Cloudflare account: the static pages (repository root, `.assetsignore` hides the server files), a D1 database (`worker/schema.sql`, same tables as before), KV for menu photos, a 10-minute cron (feedback emails + unprinted-order alert) and the same API paths the pages already call (`/rest/v1`, `/auth/v1`, `/functions/v1`, `/storage/v1`), so the pages did not change. `backend.js` uses the Cloudflare API on `kaycharly.fr`, `*.workers.dev` and local `wrangler dev` (port 8787), and the former Supabase project everywhere else until the switch. Secrets: `ADMIN_PASSWORD`, `BREVO_API_KEY`, `SHEET_TOKEN`; var `SITE_ORIGIN`. Local test: `npx wrangler d1 execute kaycharly --local --file worker/schema.sql`, then `npx wrangler dev --local` with a `.dev.vars` file.

- `index.html`: storefront, live menu, category filters, cart, takeaway and delivery checkout. If the menu cannot load, it asks visitors to call.
- `admin.html`, `admin.js`, `admin.css`: authenticated order management, search/status/date filters, daily menu, prices, photos, featured dishes and availability.
- Menu: the public carte combines the flyer, the shop menu board and earlier menu files. Items in the `Hors carte` category stay in the admin but are not shown on the site.
- `backend.js`: public Supabase URL and publishable key only. Never add a service-role key or passwords here.
- `supabase/schema.sql`: database schema, RLS, server-calculated order totals and initial menu seed. Run once in a new project.

Serve the repository root with any static HTTP server. No build step is needed. The public landing design is independent of menu edits.

## Admin access

The login name `admin` maps to an internal Supabase Auth identifier. Create the user through Supabase Authentication and set its password privately. Grant the intended user's UUID membership in `kc_admins` using the SQL editor. Only explicit members can read customer orders, change status, edit menu items or upload photos. An Auth account alone does not grant administrative access. There is no public signup or shared demo PIN in the application.

The internal identifier does not have an email inbox; password recovery must be handled by the project owner in Supabase. Never publish credentials in this repository.

## Orders

Checkout submits to `kc_place_order_with_email`. The database validates quantities and availability, reads current menu prices, calculates the total, and issues an order reference. Request UUIDs prevent duplicate orders after network retries. Customers cannot read the orders table. Orders are visible in the admin panel; email notification is configured separately below. Payment is cash at handoff for takeaway or delivery. Delivery has no extra fee. Phone-based submission throttling is basic; stronger bot protection can be added separately.

The admin loads the 500 latest orders and polls every 15 seconds while visible. Times and daily totals use Europe/Paris. Menu updates appear on the storefront's next page load. Photos are stored in the public menu-photos bucket; write access requires admin membership. The technical checkout verification order is explicitly labelled, cancelled and archived outside the admin order list.


## Order emails

The `order-notifications` Supabase Edge Function (`supabase/functions/order-notifications/index.ts`, a single file so it can be pasted into the Supabase dashboard editor) runs after each order is saved and sends two French emails through Brevo from `kaycharly37@gmail.com`:

- **Customer**: confirmation sent to the email entered at checkout, with the items, total and pickup/delivery details.
- **Owner** (`kaycharly91750@gmail.com`): an "Imprimer le reçu" button, the receipt itself, client details (call/email links, Google Maps link for deliveries), the note, and the receipt as an 80 mm PDF (`Recu-<reference>.pdf`).

The print button opens `admin.html#imprimer=<reference>`. After admin login, that page shows the receipt (`admin-receipt.js`), sized by the printer's paper, and opens the print dialog. Each order card in the admin also has a "Reçu" button.

Secrets: `BREVO_API_KEY` (required; `kaycharly37@gmail.com` must be a verified Brevo sender). Optional: `OWNER_EMAIL`, `SENDER_EMAIL`, `SITE_ORIGIN` (default `https://maniksahni.github.io`). Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Sent emails can be checked in Brevo under Transactional → Logs.

If sending fails, the order is still saved and stays visible in the admin.

## Automatic printing

Printer: 80 mm thermal receipt printer (ESC/POS, USB + Bluetooth, auto-cutter), 72 mm printable width. Tickets are continuous: as long as the order, then cut.

`admin-print.js` prints each new order while the admin is open and logged in, plays a sound, and marks the card "Imprimé à …". Orders that existed before printing was switched on, and orders older than 12 hours, are never printed automatically. The ticket is drawn as an image 576 dots wide (72 mm at 203 dpi) and sent as ESC/POS `GS v 0` bands followed by a cut, so accents and € always print.

Connection is done **from the restaurant's Android phone only** (Chrome on Android). One big button tries paired Bluetooth, then Bluetooth without pairing, then a USB cable with a phone adapter (OTG); a method that fails on the phone is skipped next time, and a confirmed test ticket resets the ladder:

- **Bluetooth appairé** (Web Serial over the standard Bluetooth serial service, SPP): the printer is paired once in the phone's Bluetooth settings (code 0000/1234) and listed by Chrome. This is how the restaurant's Tasofac printer connected (Android 10, Chrome 157, 14/11/2026). Reopening the page reconnects by itself.
- **Bluetooth sans appairage** (Web Bluetooth): for printers that speak Bluetooth Low Energy; ESC/POS sent in 180-byte writes (20 if the printer needs it) to the printer's writable GATT characteristic. Paper status is not readable this way. After the page is reopened Chrome may need one touch on « Reconnecter »; when the page comes back to the front it reconnects by itself if it can.
- **Câble USB** (WebUSB, with an OTG adapter): reads the real-time status (`DLE EOT`: cover, paper, offline).

While the page is open the screen stays on (Wake Lock). If the owner switches app or locks the phone, Chrome pauses the page; orders that arrived meanwhile print when the page is back.

A full-screen assistant (« 🧭 Assistant pas à pas ») walks the owner through it one screen at a time with big text and drawings: paper, power, connect (same ladder), test ticket (« Oui / Non » — « Non » offers the next method), done. It can read each step aloud in French, has a « J’ai besoin d’aide » button that shows up in the remote follow-up, opens by itself on first login on the phone, and can be opened directly with `admin.html#imprimante`. In another browser it shows « Il faut Google Chrome ».

On a computer the Imprimante tab does not connect anything: it explains that the printer is set up from the phone (with the link) and shows the remote follow-up.

Remote follow-up: the phone reports its state to `kc_printer_status` (ready, step it is stuck on, printer, last ticket, last error, `diag`: OS, Chrome version, USB/Bluetooth support, methods tried, page visible) and its actions to `kc_printer_events` (admins only; migrations `20261112120000_printer_status.sql`, `20261112130000_printer_ble_diag.sql`). The "Suivi à distance" panel shows this to any logged-in admin, with a button that asks the phone to print a test ticket (a `remote_test` event it polls every 20 s; a new device never replays old requests).

## Unprinted order alert

The feedback cron (`customer-mailings`, every 10 minutes) also checks printing: a « Nouvelle » order of the last 3 hours that arrived more than 10 minutes ago without a `print_ok` from the restaurant phone triggers one email to the owner listing the order(s) and what to check (phone on the Kay Charly page, printer on). Each order is alerted once (`unprinted_alert` event). Grants: `20261115100000_print_alert_grants.sql`.

Both Edge Functions accept browser calls from `maniksahni.github.io`, `kaycharly.pages.dev` (and its preview subdomains), `kaycharly.fr` and `www.kaycharly.fr`.

## Day summary, export and Google Sheet

- **Admin, « Aujourd’hui »**: today's orders by status (à préparer, en préparation, prêtes, remises with livrées / à emporter, annulées), delivery vs take-away, and a 7-day table. **« Exporter les commandes (Excel / CSV) »** downloads every loaded order (semicolon CSV with BOM, opens in Excel/Sheets) — also a manual backup.
- **Google Sheet** (`google-sheet/KayCharly.gs`): an Apps Script pasted into the owner's Sheet calls `https://kaycharly.fr/functions/v1/customer-mailings` with `{"action":"sheet"}` and the `x-sheet-token` header (Cloudflare secret `SHEET_TOKEN`, same value in the script's properties). Every 10 minutes it rewrites five tabs: « Aujourd’hui », « Par jour », « Commandes » (every order), « Clients » (one row per customer: contact, orders, money spent, e-mail consent) and « Avis » (ratings and comments). Read-only.

## Customer emails (menu du jour, avis)

`supabase/functions/customer-mailings` (Brevo):

- **Menu du jour**: admin → Carte → « 📣 Envoyer le menu aux clients ». Preview of the exact email, the list of recipients (every customer who ordered, minus unsubscribed and test orders), « 📧 M’envoyer un test » (owner only), then send. Uses the available « Plats du jour ». A banner suggests sending after a daily-menu change; nothing is sent automatically. An optional short message from the owner appears at the top. A send less than 18 hours after the previous one goes out as « 🔄 Mise à jour » (« Petit changement : voici le menu à jour »); only a repeat within 2 minutes (double click) asks for confirmation.
- **« Comment était votre repas ? »**: a Supabase Cron job (`kc-feedback-emails`, every 10 minutes) calls the function with `{"action":"feedback"}`. Each order gets one email 30 minutes after the end of its service window: delivery ordered before 10h → 12h00 the same day (otherwise next day); pickup → 14h30, or 21h30 for evening orders (before 21h, Wednesday to Sunday). Cancelled, archived and older than 3 days orders are skipped. Stars link to `avis.html` (private token per order); ratings appear in admin → « ⭐ Avis clients ».
- **Unsubscribe**: every email links to `desinscription.html?t=<token>` (button, plus re-subscribe). Checkout has an opt-out box.
- Database: migrations `20261113100000_customer_mailings.sql` and `20261113120000_customer_mailings_grants.sql`. The function verifies admin logins itself for the menu action; the cron job needs « Verify JWT » turned off for this function (it sends no auth header).
