-- Wireless Bluetooth printing mode and a diagnostics snapshot per computer.
alter table public.kc_printer_status drop constraint if exists kc_printer_status_mode_check;
alter table public.kc_printer_status add constraint kc_printer_status_mode_check check (mode in ('', 'usb', 'ble', 'serial', 'browser'));
alter table public.kc_printer_status add column if not exists diag jsonb not null default '{}'::jsonb;
