-- Customer mailings: "menu du jour" sent by the owner, automatic "comment était votre repas ?" after the
-- service, the customers' ratings, and unsubscribe. Emails are sent by the customer-mailings Edge Function.

-- Feedback email bookkeeping on each order (token = the private link the customer clicks to rate).
alter table public.kc_orders add column if not exists feedback_sent_at timestamptz;
alter table public.kc_orders add column if not exists feedback_token uuid;

-- One row per customer email: private token for the unsubscribe link, and whether they unsubscribed.
create table if not exists public.kc_email_prefs (
  email           text primary key check (email = lower(email) and length(email) between 3 and 254),
  token           uuid not null default gen_random_uuid(),
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Ratings left by customers from the feedback email.
create table if not exists public.kc_feedback (
  order_reference text primary key check (order_reference ~ '^KC-[A-F0-9]{10}$'),
  rating          smallint not null check (rating between 1 and 5),
  comment         text not null default '' check (length(comment) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- History of menu mailings (and a guard against sending the same menu twice by mistake).
create table if not exists public.kc_mailings (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('menu')),
  subject    text not null default '' check (length(subject) <= 200),
  recipients integer not null default 0,
  sent       integer not null default 0,
  failed     integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.kc_email_prefs enable row level security;
alter table public.kc_feedback enable row level security;
alter table public.kc_mailings enable row level security;
revoke all on public.kc_email_prefs, public.kc_feedback, public.kc_mailings from anon;

drop policy if exists email_prefs_admin on public.kc_email_prefs;
create policy email_prefs_admin on public.kc_email_prefs for select to authenticated using (public.kc_is_admin());
drop policy if exists feedback_admin on public.kc_feedback;
create policy feedback_admin on public.kc_feedback for select to authenticated using (public.kc_is_admin());
drop policy if exists mailings_admin on public.kc_mailings;
create policy mailings_admin on public.kc_mailings for select to authenticated using (public.kc_is_admin());
grant select on public.kc_email_prefs, public.kc_feedback, public.kc_mailings to authenticated;

-- ---- Public functions used by the customer pages (avis.html, desinscription.html) ----

-- What the rating page shows: first name, date, items, and any rating already given. Needs the private token.
create or replace function public.kc_feedback_get(p_reference text, p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'first_name', split_part(trim(o.customer_name), ' ', 1),
    'created_at', o.created_at,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i->>'name', 'quantity', (i->>'quantity')::int)), '[]'::jsonb) from jsonb_array_elements(o.items) i),
    'rating', f.rating, 'comment', f.comment)
  from public.kc_orders o left join public.kc_feedback f on f.order_reference = o.reference
  where o.reference = p_reference and o.feedback_token = p_token and p_token is not null;
$$;

create or replace function public.kc_feedback_submit(p_reference text, p_token uuid, p_rating int, p_comment text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Note invalide'; end if;
  if not exists (select 1 from public.kc_orders where reference = p_reference and feedback_token = p_token and p_token is not null) then
    raise exception 'Lien invalide';
  end if;
  insert into public.kc_feedback (order_reference, rating, comment)
  values (p_reference, p_rating, left(coalesce(trim(p_comment), ''), 1000))
  on conflict (order_reference) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
  return true;
end;
$$;

-- Unsubscribe (link in every email, private token only). Returns the address partly hidden, for the page.
create or replace function public.kc_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  update public.kc_email_prefs set unsubscribed_at = coalesce(unsubscribed_at, now())
  where token = p_token and p_token is not null returning email into v;
  if v is null then raise exception 'Lien invalide'; end if;
  return left(v, 2) || '•••@' || split_part(v, '@', 2);
end;
$$;

-- Re-subscribe (button on the unsubscribe page, in case of a mistake).
create or replace function public.kc_resubscribe(p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.kc_email_prefs set unsubscribed_at = null where token = p_token and p_token is not null;
  if not found then raise exception 'Lien invalide'; end if;
  return true;
end;
$$;

-- Checkout box "je ne veux pas recevoir le menu du jour": allowed only right after placing that order.
create or replace function public.kc_menu_optout_after_order(p_reference text, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v text := lower(trim(p_email));
begin
  if not exists (select 1 from public.kc_orders where reference = p_reference and lower(customer_email) = v and created_at > now() - interval '30 minutes') then
    raise exception 'Commande introuvable';
  end if;
  insert into public.kc_email_prefs (email, unsubscribed_at) values (v, now())
  on conflict (email) do update set unsubscribed_at = coalesce(public.kc_email_prefs.unsubscribed_at, now());
  return true;
end;
$$;

revoke all on function public.kc_feedback_get(text, uuid), public.kc_feedback_submit(text, uuid, int, text),
  public.kc_unsubscribe(uuid), public.kc_resubscribe(uuid), public.kc_menu_optout_after_order(text, text) from public;
grant execute on function public.kc_feedback_get(text, uuid), public.kc_feedback_submit(text, uuid, int, text),
  public.kc_unsubscribe(uuid), public.kc_resubscribe(uuid), public.kc_menu_optout_after_order(text, text) to anon, authenticated;

-- Orders that existed before this feature never get a late feedback email.
update public.kc_orders set feedback_sent_at = coalesce(feedback_sent_at, now()) where created_at < now() - interval '1 day';
