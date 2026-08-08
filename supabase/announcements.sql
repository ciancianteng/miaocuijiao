-- Announcement extras for homepage ticker: pin + publish time.
alter table public.announcements add column if not exists is_pinned boolean not null default false;
alter table public.announcements add column if not exists published_at timestamptz;

update public.announcements
set published_at = coalesce(published_at, created_at, now())
where published_at is null;

create index if not exists idx_announcements_pinned_published
  on public.announcements(is_active, is_pinned desc, published_at desc);

-- See also: supabase/announcements-classified.sql (category / audience / schedule / scroll / sort)
