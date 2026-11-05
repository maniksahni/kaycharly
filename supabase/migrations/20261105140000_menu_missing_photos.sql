-- Gives the items saved without a photo an image, so none appears broken on the storefront.
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/boissons-source.webp', updated_at=now() where name='Royal soda' and photo='';
update public.kc_menu set photo='https://maniksahni.github.io/kaycharly/img/glace.svg', updated_at=now() where name='Pot de glace';
