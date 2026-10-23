begin;
create table if not exists public.kc_admins(user_id uuid primary key references auth.users(id));
alter table public.kc_admins enable row level security;
revoke all on public.kc_admins from anon, authenticated;
create or replace function public.kc_is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.kc_admins where user_id=auth.uid()) $$;
revoke all on function public.kc_is_admin() from public;
grant execute on function public.kc_is_admin() to authenticated;
create table if not exists public.kc_menu(id text primary key, name text not null check(length(name) between 1 and 100), description text not null default '', category text not null, price integer not null check(price between 0 and 99900), photo text not null default '', available boolean not null default true, featured boolean not null default false, sort_order integer not null default 0, updated_at timestamptz not null default now());
alter table public.kc_menu enable row level security;
create policy menu_public on public.kc_menu for select to anon,authenticated using(true);
create policy menu_admin on public.kc_menu for all to authenticated using(public.kc_is_admin()) with check(public.kc_is_admin());
grant select on public.kc_menu to anon,authenticated;
grant insert,update,delete on public.kc_menu to authenticated;
create table if not exists public.kc_orders(id uuid primary key default gen_random_uuid(), reference text not null unique, created_at timestamptz not null default now(), customer_name text not null, customer_email text not null default '', phone text not null, address text not null default '', note text not null default '', pickup text not null, items jsonb not null, total integer not null, status text not null default 'Nouvelle' check(status in('Nouvelle','En préparation','Prête','Retirée','Annulée')), request_id uuid not null unique, archived_at timestamptz);
alter table public.kc_orders enable row level security;
revoke all on public.kc_orders from anon,authenticated;
grant select on public.kc_orders to authenticated;
grant update(status) on public.kc_orders to authenticated;
create policy orders_admin_read on public.kc_orders for select to authenticated using(public.kc_is_admin() and archived_at is null);
create policy orders_admin_status on public.kc_orders for update to authenticated using(public.kc_is_admin()) with check(public.kc_is_admin());
create or replace function public.kc_place_order(p_request_id uuid,p_name text,p_phone text,p_address text,p_note text,p_pickup text,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare it jsonb; dish public.kc_menu%rowtype; snapshot jsonb:='[]'; amount integer:=0; q integer; ref text; previous public.kc_orders%rowtype;
begin
if length(trim(p_name)) not between 2 and 60 or p_phone !~ '^0[1-9][0-9]{8}$' or length(p_address)>160 or length(p_note)>300 or length(p_pickup) not between 1 and 100 then raise exception 'Informations de commande invalides'; end if;
perform pg_advisory_xact_lock(hashtext(p_phone));
select * into previous from public.kc_orders where request_id=p_request_id;
if found then return jsonb_build_object('reference',previous.reference,'total',previous.total); end if;
if (select count(*) from public.kc_orders where phone=p_phone and created_at>now()-interval '5 minutes')>=3 then raise exception 'Veuillez patienter avant une nouvelle commande'; end if;
if jsonb_typeof(p_items)!='array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Panier invalide'; end if;
for it in select value from jsonb_array_elements(p_items) loop
 q:=(it->>'quantity')::integer;
 if q not between 1 and 20 then raise exception 'Quantité invalide'; end if;
 select * into dish from public.kc_menu where id=it->>'id' for share;
 if not found or not dish.available or dish.price<=0 then raise exception 'Un plat est indisponible, actualisez votre panier'; end if;
 amount:=amount+dish.price*q;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('id',dish.id,'name',dish.name,'quantity',q,'price',dish.price));
end loop;
if amount>100000 then raise exception 'Pour une grande commande, appelez la boutique'; end if;
ref:='KC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
insert into public.kc_orders(reference,customer_name,phone,address,note,pickup,items,total,request_id) values(ref,trim(p_name),p_phone,p_address,p_note,p_pickup,snapshot,amount,p_request_id);
return jsonb_build_object('reference',ref,'total',amount);
end $$;
create or replace function public.kc_place_order_with_email(p_request_id uuid,p_name text,p_email text,p_phone text,p_address text,p_note text,p_pickup text,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare it jsonb; dish public.kc_menu%rowtype; snapshot jsonb:='[]'; amount integer:=0; q integer; ref text; previous public.kc_orders%rowtype;
begin
if length(trim(p_name)) not between 2 and 60 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(p_email)>254 or p_phone !~ '^0[1-9][0-9]{8}$' or length(p_address)>160 or length(p_note)>300 or length(p_pickup) not between 1 and 100 then raise exception 'Informations de commande invalides'; end if;
perform pg_advisory_xact_lock(hashtext(p_phone));
select * into previous from public.kc_orders where request_id=p_request_id;
if found then return jsonb_build_object('reference',previous.reference,'total',previous.total); end if;
if (select count(*) from public.kc_orders where phone=p_phone and created_at>now()-interval '5 minutes')>=3 then raise exception 'Veuillez patienter avant une nouvelle commande'; end if;
if jsonb_typeof(p_items)!='array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Panier invalide'; end if;
for it in select value from jsonb_array_elements(p_items) loop
 q:=(it->>'quantity')::integer;
 if q not between 1 and 20 then raise exception 'Quantité invalide'; end if;
 select * into dish from public.kc_menu where id=it->>'id' for share;
 if not found or not dish.available or dish.price<=0 then raise exception 'Un plat est indisponible, actualisez votre panier'; end if;
 amount:=amount+dish.price*q;
 snapshot:=snapshot||jsonb_build_array(jsonb_build_object('id',dish.id,'name',dish.name,'quantity',q,'price',dish.price));
end loop;
if amount>100000 then raise exception 'Pour une grande commande, appelez la boutique'; end if;
ref:='KC-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
insert into public.kc_orders(reference,customer_name,customer_email,phone,address,note,pickup,items,total,request_id) values(ref,trim(p_name),lower(trim(p_email)),p_phone,p_address,p_note,p_pickup,snapshot,amount,p_request_id);
return jsonb_build_object('reference',ref,'total',amount);
end $$;
revoke all on function public.kc_place_order_with_email(uuid,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.kc_place_order_with_email(uuid,text,text,text,text,text,text,jsonb) to anon,authenticated;
revoke all on function public.kc_place_order(uuid,text,text,text,text,text,jsonb) from public;
grant execute on function public.kc_place_order(uuid,text,text,text,text,text,jsonb) to anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('menu-photos','menu-photos',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy kc_photo_read on storage.objects for select to anon,authenticated using(bucket_id='menu-photos');
create policy kc_photo_insert on storage.objects for insert to authenticated with check(bucket_id='menu-photos' and public.kc_is_admin());
commit;

insert into public.kc_menu(id,name,description,category,price,photo,featured,sort_order) values
('pdj','Fricassé de crevettes','Plat du jour · riz jaune','Plats',1200,'https://maniksahni.github.io/kaycharly/img/gambas-source.webp',true,0),
('viande','Viande en sauce + riz','Riz blanc ou riz madras','Plats',900,'https://maniksahni.github.io/kaycharly/img/viande-riz-source.webp',true,1),
('poisson','Poisson + riz','Poisson frit ou crustacés, riz blanc ou madras','Plats',1000,'https://maniksahni.github.io/kaycharly/img/poisson-riz-source.webp',true,2),
('poissonc','Poisson aux oignons & citron','Piment doux, citron vert','Plats',1000,'https://maniksahni.github.io/kaycharly/img/poisson-citron-source.webp',false,3),
('mviande','Menu viande','Viande + riz + dessert + jus exotique frais ou cocktail','Plats',1400,'https://maniksahni.github.io/kaycharly/img/racines-source.webp',false,4),
('mpoisson','Menu poisson','Poisson + riz + dessert + jus exotique frais ou cocktail','Plats',1500,'https://maniksahni.github.io/kaycharly/img/poisson-lentilles-source.webp',false,5),
('pf','Poulet-frites','Poulet grillé laqué, frites','Poulet-frites',750,'https://maniksahni.github.io/kaycharly/img/poulet-source.webp',false,6),
('mpf','Menu poulet-frites','Poulet-frites + jus frais','Poulet-frites',950,'https://maniksahni.github.io/kaycharly/img/poulet-source.webp',false,7),
('cpf','Coffret : 3 poulet-frites','Pour toute la famille','Poulet-frites',2000,'https://maniksahni.github.io/kaycharly/img/poulet-source.webp',false,8),
('sp','Sandwich poulet','Poulet, cheddar, oignon mariné + frites','Sandwichs',850,'https://maniksahni.github.io/kaycharly/img/burger-source.webp',false,9),
('spo','Sandwich poisson','Poisson, crudités, oignon mariné + frites','Sandwichs',900,'https://maniksahni.github.io/kaycharly/img/burger-source.webp',false,10),
('msp','Menu sandwich poulet','Sandwich + frites + dessert ou jus frais','Sandwichs',1200,'https://maniksahni.github.io/kaycharly/img/burger-source.webp',false,11),
('msm','Menu sandwich poisson / morue','Sandwich + frites + dessert ou jus frais','Sandwichs',1300,'https://maniksahni.github.io/kaycharly/img/burger-source.webp',false,12),
('am','Accras de morue','La boîte','Apéritif',1000,'https://maniksahni.github.io/kaycharly/img/accras-source.webp',true,13),
('ac','Accras de crevettes','La boîte','Apéritif',1500,'https://maniksahni.github.io/kaycharly/img/accras-source.webp',false,14),
('bd','Boudin noir','La pochette de 10','Apéritif',1200,'https://maniksahni.github.io/kaycharly/img/boudin-source.webp',false,15),
('ps','Pâté salé','Poulet, morue ou légumes · à l’unité','Apéritif',100,'https://maniksahni.github.io/kaycharly/img/pates-source.webp',false,16),
('tc','Tarte coco','Coco râpé, cerises confites · la part','Douceurs & boissons',300,'https://maniksahni.github.io/kaycharly/img/tarte-coco-source.webp',false,17),
('bi','Biscuits coco','Le sachet','Douceurs & boissons',300,'https://maniksahni.github.io/kaycharly/img/biscuits-source.webp',false,18),
('bm','Blanc-manger coco','Dessert maison','Douceurs & boissons',300,'https://maniksahni.github.io/kaycharly/img/tarte-coco-source.webp',false,19),
('jus','Jus exotique frais','Selon l’arrivage','Douceurs & boissons',350,'https://maniksahni.github.io/kaycharly/img/boissons-source.webp',false,20),
('glace','Pot de glace','Selon la saison','Douceurs & boissons',300,'https://maniksahni.github.io/kaycharly/img/tarte-coco-source.webp',false,21),
('tiramisu','Tiramisu maison','Parfums selon disponibilité · prix à confirmer','Douceurs & boissons',0,'https://maniksahni.github.io/kaycharly/img/tarte-coco-source.webp',false,22) on conflict(id) do nothing;
