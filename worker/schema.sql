-- Kay Charly · Cloudflare D1 database (SQLite). Same tables and columns as the former Supabase database.
-- Times are ISO-8601 UTC strings (e.g. 2026-11-15T10:30:00.000Z); booleans are 0/1; JSON is stored as text.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS kc_menu (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0 CHECK (price BETWEEN 0 AND 99900),
  photo       TEXT NOT NULL DEFAULT '',
  available   INTEGER NOT NULL DEFAULT 1,
  featured    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kc_orders (
  id               TEXT PRIMARY KEY,
  reference        TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  customer_email   TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL,
  address          TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  pickup           TEXT NOT NULL,
  items            TEXT NOT NULL,
  total            INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Nouvelle' CHECK (status IN ('Nouvelle','En préparation','Prête','Retirée','Annulée')),
  request_id       TEXT NOT NULL UNIQUE,
  archived_at      TEXT,
  feedback_sent_at TEXT,
  feedback_token   TEXT,
  notified_at      TEXT
);
CREATE INDEX IF NOT EXISTS kc_orders_created ON kc_orders (created_at);
CREATE INDEX IF NOT EXISTS kc_orders_phone ON kc_orders (phone, created_at);

CREATE TABLE IF NOT EXISTS kc_email_prefs (
  email           TEXT PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  unsubscribed_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kc_feedback (
  order_reference TEXT PRIMARY KEY,
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kc_mailings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  recipients INTEGER NOT NULL DEFAULT 0,
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kc_printer_status (
  device_id      TEXT PRIMARY KEY,
  device_name    TEXT NOT NULL DEFAULT '',
  platform       TEXT NOT NULL DEFAULT '',
  mode           TEXT NOT NULL DEFAULT '',
  printer_name   TEXT NOT NULL DEFAULT '',
  ready          INTEGER NOT NULL DEFAULT 0,
  stuck_step     INTEGER,
  stuck_label    TEXT NOT NULL DEFAULT '',
  steps          TEXT NOT NULL DEFAULT '[]',
  last_print_ref TEXT NOT NULL DEFAULT '',
  last_print_at  TEXT,
  last_error     TEXT NOT NULL DEFAULT '',
  diag           TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS kc_printer_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id  TEXT NOT NULL,
  event      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS kc_printer_events_recent ON kc_printer_events (created_at);
CREATE INDEX IF NOT EXISTS kc_printer_events_device ON kc_printer_events (device_id, event, id);

-- Failed admin logins, to slow down password guessing.
CREATE TABLE IF NOT EXISTS kc_login_attempts (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kc_login_attempts_ip ON kc_login_attempts (ip, at);
