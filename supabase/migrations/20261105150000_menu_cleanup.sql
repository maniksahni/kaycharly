-- Gives every item a distinct name, since orders only record the name, and fixes the menu order and typos.
begin;
update public.kc_menu set name='Royal Soda Anis', description='Boisson', updated_at=now() where id='5451431a-f40d-4853-b444-3c398bb053da';
update public.kc_menu set name='Royal Soda Ananas', description='Boisson', updated_at=now() where id='39ae0a10-0f12-477d-b518-2e38dcc9bb7c';
update public.kc_menu set name='Royal Soda Grenadine', description='Boisson', updated_at=now() where id='07d027cc-1b6a-4d69-b179-122214ee910b';
update public.kc_menu set name='Royal Soda Kola Champagne', description='Boisson', updated_at=now() where id='30fb56e2-34dd-4772-a034-d87d31db605a';
update public.kc_menu set name='Pot de glace 1 litre', description='Selon la saison', category='Douceurs & boissons', updated_at=now() where id='82684d48-f037-4120-980c-f5c9a72f3281';
update public.kc_menu set name='Mont Blanc entier (noix de coco)', description='Coco râpé, cerises confites · le gâteau', updated_at=now() where id='tc';
update public.kc_menu set name='Mont Blanc (noix de coco)', description='Coco râpé, cerises confites · la part', updated_at=now() where id='bm';
update public.kc_menu set name='Plat du jour - Bœuf salé avec légumes', updated_at=now() where id='mviande';
update public.kc_menu set description='Accompagnement : riz jaune', updated_at=now() where id='pdj';
update public.kc_menu set description='Accompagnement : riz blanc ou riz madras', updated_at=now() where id='viande';
update public.kc_menu set description='Poulet grillé (boucané), frites', updated_at=now() where id='pf';
update public.kc_menu set description='Poulet-frites + jus frais (goyave, ananas, mangue, passion)', updated_at=now() where id='mpf';
update public.kc_menu set description='Exotique, liqueur, shrubb', updated_at=now() where id='jus';
update public.kc_menu set description='Coco, passion, goyave ou kinder', updated_at=now() where id='tiramisu';
update public.kc_menu m set sort_order=o.n from (values
 ('pdj',0),('viande',1),('poisson',2),('mviande',3),('flyer-viandes',4),('flyer-poissons',5),('poissonc',6),('flyer-menu-viande',7),('mpoisson',8),
 ('pf',9),('mpf',10),('cpf',11),('sp',12),('spo',13),('msp',14),('msm',15),
 ('am',16),('ac',17),('d279eadb-12d5-4182-b20c-a1080bae8739',18),('bd',19),('ps',20),
 ('flyer-jus',21),('jus',22),('5451431a-f40d-4853-b444-3c398bb053da',23),('39ae0a10-0f12-477d-b518-2e38dcc9bb7c',24),('07d027cc-1b6a-4d69-b179-122214ee910b',25),('30fb56e2-34dd-4772-a034-d87d31db605a',26),
 ('tc',27),('bm',28),('tiramisu',29),('glace',30),('82684d48-f037-4120-980c-f5c9a72f3281',31),('bi',32)
) as o(id,n) where m.id=o.id;
commit;
