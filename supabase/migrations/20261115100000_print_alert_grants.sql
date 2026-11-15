-- The customer-mailings Edge Function (service role) checks whether new orders were printed and, if not,
-- emails the owner once per order (event "unprinted_alert"). This project does not grant new tables to the
-- service role by default, so grant exactly what it needs.
grant select on public.kc_printer_status to service_role;
grant select, insert on public.kc_printer_events to service_role;
do $$
declare seq text := pg_get_serial_sequence('public.kc_printer_events', 'id');
begin
  if seq is not null then execute format('grant usage on sequence %s to service_role', seq); end if;
end $$;
