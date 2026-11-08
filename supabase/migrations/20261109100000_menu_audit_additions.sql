-- Items found in earlier menu files during the full audit. Price 0 shows as "Sur appel".
begin;
update public.kc_menu set name='Punch coco', description='Crème de coco · la bouteille', updated_at=now() where id='f-coco-dormoy';
insert into public.kc_menu(id,name,description,category,price,available,featured,sort_order,photo) values('f-nougat','Nougat Charly Douceur','','Boissons & douceurs',0,true,false,86,'') on conflict(id) do nothing;
commit;
