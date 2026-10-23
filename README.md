# Kay Charly

Static restaurant storefront hosted on GitHub Pages, with a Supabase database and authenticated administration.

- `index.html`: storefront, live menu, category filters, cart and pickup checkout.
- `admin.html`, `admin.js`, `admin.css`: authenticated order management, search/status/date filters, daily menu, prices, photos, featured dishes and availability.
- `backend.js`: public Supabase URL and publishable key only. Never add a service-role key or passwords here.
- `supabase/schema.sql`: database schema, RLS, server-calculated order totals and initial menu seed. Run once in a new project.

Serve the repository root with any static HTTP server. No build step is needed. The public landing design is independent of menu edits.

## Admin access

The login name `admin` maps to an internal Supabase Auth identifier. Create the user through Supabase Authentication and set its password privately. Grant the intended user's UUID membership in `kc_admins` using the SQL editor. Only explicit members can read customer orders, change status, edit menu items or upload photos. An Auth account alone does not grant administrative access. There is no public signup or shared demo PIN in the application.

The internal identifier does not have an email inbox; password recovery must be handled by the project owner in Supabase. Never publish credentials in this repository.

## Orders

Checkout submits to `kc_place_order`. The database validates quantities and availability, reads current menu prices, calculates the total, and issues an order reference. Request UUIDs prevent duplicates after network retries. Customers cannot read the orders table. Orders are visible in the admin panel and do not send email/SMS notifications. Payment is cash at handoff for takeaway or delivery; delivery zones and any fee are confirmed by the shop. Phone-based submission throttling is basic; stronger bot protection can be added separately.

The admin loads the 500 latest orders and polls every 15 seconds while visible. Times and daily totals use Europe/Paris. Menu updates appear on the storefront's next page load. Photos are stored in the public menu-photos bucket; write access requires admin membership. The technical checkout verification order is explicitly labelled, cancelled and archived outside the admin order list.
