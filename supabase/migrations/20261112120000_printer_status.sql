-- Printer status reported by the admin page on each computer, so the setup can be followed remotely:
-- which step the restaurant computer is stuck on, the printer's live state, and a short event history.
-- Only admins can read or write.

create table if not exists public.kc_printer_status (
  device_id      text primary key check (length(device_id) between 8 and 64),
  device_name    text not null default '' check (length(device_name) <= 60),
  platform       text not null default '' check (length(platform) <= 120),
  mode           text not null default '' check (mode in ('', 'usb', 'serial', 'browser')),
  printer_name   text not null default '' check (length(printer_name) <= 120),
  ready          boolean not null default false,
  stuck_step     smallint,
  stuck_label    text not null default '' check (length(stuck_label) <= 200),
  steps          jsonb not null default '[]'::jsonb,
  last_print_ref text not null default '' check (length(last_print_ref) <= 20),
  last_print_at  timestamptz,
  last_error     text not null default '' check (length(last_error) <= 300),
  updated_at     timestamptz not null default now()
);

create table if not exists public.kc_printer_events (
  id         bigint generated always as identity primary key,
  device_id  text not null check (length(device_id) between 8 and 64),
  event      text not null check (length(event) between 1 and 40),
  detail     text not null default '' check (length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index if not exists kc_printer_events_recent on public.kc_printer_events (created_at desc);

alter table public.kc_printer_status enable row level security;
alter table public.kc_printer_events enable row level security;

drop policy if exists printer_status_admin on public.kc_printer_status;
create policy printer_status_admin on public.kc_printer_status for all to authenticated
  using (public.kc_is_admin()) with check (public.kc_is_admin());

drop policy if exists printer_events_admin_read on public.kc_printer_events;
create policy printer_events_admin_read on public.kc_printer_events for select to authenticated using (public.kc_is_admin());
drop policy if exists printer_events_admin_insert on public.kc_printer_events;
create policy printer_events_admin_insert on public.kc_printer_events for insert to authenticated with check (public.kc_is_admin());

revoke all on public.kc_printer_status, public.kc_printer_events from anon;
grant select, insert, update, delete on public.kc_printer_status to authenticated;
grant select, insert on public.kc_printer_events to authenticated;

-- Keep the event log small: drop events older than 30 days whenever a new one arrives.
create or replace function public.kc_printer_events_trim() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.kc_printer_events where created_at < now() - interval '30 days';
  return null;
end;
$$;
revoke all on function public.kc_printer_events_trim() from public;
drop trigger if exists kc_printer_events_trim on public.kc_printer_events;
create trigger kc_printer_events_trim after insert on public.kc_printer_events
  for each statement execute function public.kc_printer_events_trim();
