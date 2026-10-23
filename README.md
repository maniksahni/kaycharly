# Kay Charly

Static restaurant storefront hosted on GitHub Pages, with a Supabase database and authenticated administration.

- `index.html`: storefront, live menu, category filters, cart, takeaway and delivery checkout.
- `admin.html`, `admin.js`, `admin.css`: authenticated order management, search/status/date filters, daily menu, prices, photos, featured dishes and availability.
- `backend.js`: public Supabase URL and publishable key only. Never add a service-role key or passwords here.
- `supabase/schema.sql`: database schema, RLS, server-calculated order totals and initial menu seed. Run once in a new project.

Serve the repository root with any static HTTP server. No build step is needed. The public landing design is independent of menu edits.

## Admin access

The login name `admin` maps to an internal Supabase Auth identifier. Create the user through Supabase Authentication and set its password privately. Grant the intended user's UUID membership in `kc_admins` using the SQL editor. Only explicit members can read customer orders, change status, edit menu items or upload photos. An Auth account alone does not grant administrative access. There is no public signup or shared demo PIN in the application.

The internal identifier does not have an email inbox; password recovery must be handled by the project owner in Supabase. Never publish credentials in this repository.

## Orders

Checkout submits to `kc_place_order_with_email`. The database validates quantities and availability, reads current menu prices, calculates the total, and issues an order reference. Request UUIDs prevent duplicate orders after network retries. Customers cannot read the orders table. Orders are visible in the admin panel; email notification is configured separately below. Payment is cash at handoff for takeaway or delivery. Delivery has no extra fee. Phone-based submission throttling is basic; stronger bot protection can be added separately.

The admin loads the 500 latest orders and polls every 15 seconds while visible. Times and daily totals use Europe/Paris. Menu updates appear on the storefront's next page load. Photos are stored in the public menu-photos bucket; write access requires admin membership. The technical checkout verification order is explicitly labelled, cancelled and archived outside the admin order list.


## Temporary order email notifications

Checkout asks each customer for the email address where they want their receipt. That address is stored with that order and used dynamically; no permanent customer email needs to be configured. The `order-notifications` Supabase Edge Function sends two branded, responsive French emails through the Gmail API after the order is saved: a receipt to the email entered for that order, and an owner alert with the customer's contact details, delivery address/map link, fulfillment details, itemized order, total and note. Both are sent from `kaycharly37@gmail.com`; owner alerts go to `kaycharly91750@gmail.com`. Both include a plain-text version. The browser only receives send status; Google OAuth and Supabase service credentials stay in server-side secrets.

For a small temporary pilot, create a Google Cloud OAuth client, enable the Gmail API, and authorize `kaycharly37@gmail.com` for the `gmail.send` scope with offline access. Set these Supabase Edge Function secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `SITE_ORIGIN` (`https://maniksahni.github.io`). `OWNER_EMAIL` and `GOOGLE_SENDER_EMAIL` default to the addresses above and may be overridden as server secrets. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the deployed function. The sender address must match the Google account that granted OAuth access. Apply `supabase/migrations/20261023110000_customer_order_email.sql`, then deploy `order-notifications`.

Email delivery failures do not cancel an order; the order remains in the admin panel. A retry of the notification endpoint can send a second copy if Google accepted the first message but the caller did not receive its response. For a permanent, higher-volume setup, move sending to a transactional email provider and add persistent per-order delivery tracking.
