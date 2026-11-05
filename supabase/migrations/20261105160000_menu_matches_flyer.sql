-- Makes the public menu match the restaurant flyer. Other items move to Hors carte, which the site does not show.
begin;
update public.kc_menu set category='Hors carte', available=false, featured=false, updated_at=now()
 where id in('pdj','viande','poisson','mviande','poissonc','ps','tc','bm','jus','tiramisu','bi','5451431a-f40d-4853-b444-3c398bb053da','39ae0a10-0f12-477d-b518-2e38dcc9bb7c','07d027cc-1b6a-4d69-b179-122214ee910b','30fb56e2-34dd-4772-a034-d87d31db605a','82684d48-f037-4120-980c-f5c9a72f3281');
update public.kc_menu set name='Pot de glace 15 €', description='' where id='82684d48-f037-4120-980c-f5c9a72f3281';
update public.kc_menu m set name=o.name, description=o.description, category=o.category, price=o.price, sort_order=o.sort_order, featured=false, updated_at=now() from (values
 ('flyer-viandes','Viandes','','À l’unité',900,0),
 ('flyer-poissons','Poissons & crustacés','','À l’unité',1000,1),
 ('flyer-menu-viande','Menu viande','Viande + dessert + jus exotique frais ou cocktail','Menus plat',1400,2),
 ('mpoisson','Menu poisson','Poisson + dessert + jus exotique frais ou cocktail','Menus plat',1500,3),
 ('pf','Poulet-frites','','Poulet-frites',750,4),
 ('cpf','Coffret : 3 poulet-frites','','Poulet-frites',2000,5),
 ('mpf','Menu poulet-frites','Poulet-frites + jus frais','Poulet-frites',950,6),
 ('sp','Sandwich poulet','Poulet, cheddar, oignon mariné + frites','Sandwichs',850,7),
 ('spo','Sandwich poisson','Poisson, crudités, oignon mariné + frites','Sandwichs',850,8),
 ('msp','Menu sandwich poulet','Sandwich + frites + tiramisu (coco, passion, goyave ou kinder), salade de fruits ou jus frais','Sandwichs',1200,9),
 ('msm','Menu sandwich poisson / morue','Sandwich + frites + tiramisu (coco, passion, goyave ou kinder), salade de fruits ou jus frais','Sandwichs',1300,10),
 ('d279eadb-12d5-4182-b20c-a1080bae8739','Boîte d’accras','','À grignoter',1000,11),
 ('am','Morue','','À grignoter',1000,12),
 ('ac','Crevette','','À grignoter',1500,13),
 ('bd','Boudin noir','La pochette de 10','À grignoter',1200,14),
 ('flyer-jus','Jus exotique frais','','Boissons & douceurs',350,15),
 ('glace','Pot de glace','Selon la saison','Boissons & douceurs',300,16)
) as o(id,name,description,category,price,sort_order) where m.id=o.id;
commit;
