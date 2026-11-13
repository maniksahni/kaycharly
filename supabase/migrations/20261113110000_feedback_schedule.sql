-- Every 10 minutes, ask the customer-mailings function to send the "Comment était votre repas ?" emails
-- that are due (30 minutes after the end of each order's service window). The function only sends
-- emails that are due and not sent yet, so this call needs no secret.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule(
  'kc-feedback-emails',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://bqtsczpszczikonpdtlo.supabase.co/functions/v1/customer-mailings',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"action": "feedback"}'::jsonb
     ) $$
);
