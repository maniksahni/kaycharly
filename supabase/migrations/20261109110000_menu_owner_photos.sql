-- Photos supplied for the drinks, plus the two drinks they revealed.
begin;
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/planteur.webp', updated_at=now() where id='jus';
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/royal-soda-kampane.webp', updated_at=now() where id='30fb56e2-34dd-4772-a034-d87d31db605a';
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/royal-soda-grenadine.webp', updated_at=now() where id='07d027cc-1b6a-4d69-b179-122214ee910b';
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/royal-soda-ananas.webp', updated_at=now() where id='39ae0a10-0f12-477d-b518-2e38dcc9bb7c';
insert into public.kc_menu(id,name,description,category,price,available,featured,sort_order,photo) values
('b-royal-banane','Royal Soda Banane','50 cl','Boissons & douceurs',250,true,false,58,'https://maniksahni.github.io/kaycharly/img/royal-soda-banane.webp'),
('b-cocktail-jus','Cocktail de jus de fruits','','Boissons & douceurs',0,true,false,52,'https://maniksahni.github.io/kaycharly/img/cocktail-jus.webp')
on conflict(id) do nothing;
commit;
