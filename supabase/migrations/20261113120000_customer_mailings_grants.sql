-- The customer-mailings Edge Function uses the service role; this project does not grant new tables to it
-- by default, so grant exactly what the function needs.
grant select, insert on public.kc_email_prefs to service_role;
grant select on public.kc_feedback to service_role;
grant select, insert on public.kc_mailings to service_role;
grant select on public.kc_orders, public.kc_menu, public.kc_admins to service_role;
grant update (feedback_sent_at, feedback_token) on public.kc_orders to service_role;
