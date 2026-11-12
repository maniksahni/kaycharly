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

The print button opens `admin.html#imprimer=<reference>`. After admin login, that page shows the receipt sized for 62 mm roll paper (`admin-receipt.js`) and opens the print dialog. Each order card in the admin also has a "Reçu" button.

Secrets: `BREVO_API_KEY` (required; `kaycharly37@gmail.com` must be a verified Brevo sender). Optional: `OWNER_EMAIL`, `SENDER_EMAIL`, `SITE_ORIGIN` (default `https://maniksahni.github.io`). Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Sent emails can be checked in Brevo under Transactional → Logs.

If sending fails, the order is still saved and stays visible in the admin.

## Automatic printing

`admin-print.js` prints each new order on the restaurant computer while the admin is open and logged in, plays a sound, and marks the card "Imprimé à …". Orders that existed before printing was switched on, and orders older than 12 hours, are never printed automatically. The "🖨️ Imprimante" tab shows live checks (browser, live orders, printer, silent printing, screen, sound), a test ticket with a "did it come out?" question, and the one-time setup steps.

- **Imprimante de l’ordinateur** (recommended on Windows): prints to the default printer (Brother QL-700, 62 mm continuous roll). To print without a dialog, open the admin with a Chrome shortcut that adds `--kiosk-printing`; the test ticket detects whether a print window still appears.
- **USB direct**: Chrome/Edge drive the Brother QL over WebUSB and read its real status (roll, cover, errors). Not available when the Windows Brother driver holds the printer.

The admin keeps polling every 15 seconds from a worker timer so background tabs keep printing; keeping the tab in front is still recommended.
