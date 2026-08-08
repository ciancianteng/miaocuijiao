-- Homepage Banner: separate mobile image + crop on the same row
-- desktop remains image_url + crop_meta; mobile is mobile_image_url + mobile_crop_meta
alter table public.banners
  add column if not exists mobile_image_url text;

alter table public.banners
  add column if not exists mobile_crop_meta jsonb not null default '{}'::jsonb;

comment on column public.banners.image_url is
  'Desktop Banner image URL (suggested 1920×700 landscape).';

comment on column public.banners.crop_meta is
  'Desktop crop editor state: { zoom, x, y, ratioW, ratioH }.';

comment on column public.banners.mobile_image_url is
  'Mobile Banner image URL (platform ratio 1080×1350 portrait). Optional; homepage falls back to desktop if empty.';

comment on column public.banners.mobile_crop_meta is
  'Mobile crop editor state: { zoom, x, y, ratioW, ratioH } for 1080×1350 frame.';
