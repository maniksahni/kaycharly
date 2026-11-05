-- Adds the flyer's "À l'unité" dishes, which the daily dishes in the admin had replaced.
insert into public.kc_menu(id,name,description,category,price,photo,featured,sort_order) values
('flyer-viandes','Viandes','À l’unité','Plats',900,'https://maniksahni.github.io/kaycharly/img/viande-riz-source.webp',false,4),
('flyer-poissons','Poissons & crustacés','À l’unité','Plats',1000,'https://maniksahni.github.io/kaycharly/img/poisson-riz-source.webp',false,4)
on conflict(id) do nothing;
