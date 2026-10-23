alter table public.kc_orders add column if not exists customer_email text not null default '';

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
