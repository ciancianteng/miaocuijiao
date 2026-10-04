-- Boss review screenshots: up to 3 public image URLs per companion review (jsonb array of strings).
-- Idempotent: safe to run more than once. Run on its own, separately from the bucket migration.
alter table public.companion_reviews
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.companion_reviews set image_urls = '[]'::jsonb where image_urls is null;
alter table public.companion_reviews alter column image_urls set default '[]'::jsonb;
alter table public.companion_reviews alter column image_urls set not null;

notify pgrst, 'reload schema';
