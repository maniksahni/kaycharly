-- Aligns the live menu with the restaurant's flyer. Leaves the daily dishes edited in the admin untouched.
begin;
update public.kc_menu set price=850, updated_at=now() where id='spo';
update public.kc_menu set description='Sandwich + frites + tiramisu (coco, passion, goyave ou kinder), salade de fruits ou jus frais', updated_at=now() where id in('msp','msm');
update public.kc_menu set name='Poulet-frites', updated_at=now() where id='pf';
update public.kc_menu set name='Coffret : 3 poulet-frites', updated_at=now() where id='cpf';
update public.kc_menu set description='Poisson + dessert + jus exotique frais ou cocktail · + 1 € si planteur à la place du jus', updated_at=now() where id='mpoisson';
insert into public.kc_menu(id,name,description,category,price,photo,featured,sort_order) values
('flyer-menu-viande','Menu viande','Viande + dessert + jus exotique frais ou cocktail · + 1 € si planteur à la place du jus','Plats',1400,'https://maniksahni.github.io/kaycharly/img/racines-source.webp',false,5),
('flyer-jus','Jus exotique frais','Selon l’arrivage','Douceurs & boissons',350,'https://maniksahni.github.io/kaycharly/img/boissons-source.webp',false,20)
on conflict(id) do nothing;
commit;
