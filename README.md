# Kay Charly

Static restaurant storefront hosted on GitHub Pages, with a Supabase database and authenticated administration.

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

Connection: one big button walks down USB → wireless Bluetooth → paired Bluetooth → computer driver; each method that fails on this computer is skipped next time, and a successful connection resets the ladder. The methods:

- **Connecter l’imprimante** (USB direct, WebUSB): Chrome/Edge talk straight to the printer and read its real-time status (`DLE EOT`: cover, paper, offline). Not possible when the Windows printer driver already holds the device; the page then says so.
- **Bluetooth sans fil** (Web Bluetooth): no pairing needed; ESC/POS sent in 180-byte writes to the printer's writable GATT characteristic. Paper status is not readable this way. After a page reload Chrome may need one click on « Reconnecter ».
- **Bluetooth appairé** (Web Serial): the printer is paired in Windows/macOS and opened as its COM port.
- **Utiliser le pilote de l’ordinateur**: prints an 80 mm page sized to the ticket through the default printer; needs the Chrome `--kiosk-printing` shortcut to print without a dialog (detected by the test ticket).

A full-screen assistant (« 🧭 Assistant pas à pas ») walks the owner through it one screen at a time with big text and drawings: paper, power/cable, connect (same ladder), test ticket (« Oui / Non » — « Non » offers the next method), shortcut screen for the driver, done. It can read each step aloud in French, has a « J’ai besoin d’aide » button that shows up in the remote follow-up, opens by itself on first login on a computer without a printer, and can be opened directly with `admin.html#imprimante`. For paired Bluetooth and the driver it shows buttons that open the Windows (or macOS) Bluetooth / printers settings directly, plus a « Télécharger Google Chrome » screen in other browsers. For the driver method on Windows it offers a launcher, `Kay Charly Caisse.cmd`: it opens `admin.html#caisse` in its own Chrome profile with `--kiosk-printing` (Chrome need not be closed), copies itself to the desktop and the Startup folder, and the `#caisse` window sets up the driver method and test ticket by itself. The tab itself is also a guided setup: numbered steps checked live, "À faire maintenant" with its button, a test ticket followed by "did it come out?", plain-language steps and troubleshooting.

Remote follow-up: each computer reports its state to `kc_printer_status` (ready, step it is stuck on, printer, last ticket, last error) and its actions to `kc_printer_events` (`supabase/migrations/20261112120000_printer_status.sql`, admins only). Each status row also carries `diag` (OS, Chrome version, USB/Bluetooth/COM support, methods already tried, paper, page visible). The "Suivi à distance" panel shows all this to any logged-in admin, with a button that asks that computer to print a test ticket (an `remote_test` event it polls every 20 s; a new computer never replays old requests). Migrations: `20261112120000_printer_status.sql`, `20261112130000_printer_ble_diag.sql`.

## Customer emails (menu du jour, avis)

`supabase/functions/customer-mailings` (Brevo):

- **Menu du jour**: admin → Carte → « 📣 Envoyer le menu aux clients ». Preview of the exact email, the list of recipients (every customer who ordered, minus unsubscribed and test orders), « 📧 M’envoyer un test » (owner only), then send. Uses the available « Plats du jour ». A banner suggests sending after a daily-menu change; nothing is sent automatically. An optional short message from the owner appears at the top. A send less than 18 hours after the previous one goes out as « 🔄 Mise à jour » (« Petit changement : voici le menu à jour »); only a repeat within 2 minutes (double click) asks for confirmation.
- **« Comment était votre repas ? »**: a Supabase Cron job (`kc-feedback-emails`, every 10 minutes) calls the function with `{"action":"feedback"}`. Each order gets one email 30 minutes after the end of its service window: delivery ordered before 10h → 12h00 the same day (otherwise next day); pickup → 14h30, or 21h30 Thursday–Saturday evening. Cancelled, archived and older than 3 days orders are skipped. Stars link to `avis.html` (private token per order); ratings appear in admin → « ⭐ Avis clients ».
- **Unsubscribe**: every email links to `desinscription.html?t=<token>` (button, plus re-subscribe). Checkout has an opt-out box.
- Database: migrations `20261113100000_customer_mailings.sql` and `20261113120000_customer_mailings_grants.sql`. The function verifies admin logins itself for the menu action; the cron job needs « Verify JWT » turned off for this function (it sends no auth header).
