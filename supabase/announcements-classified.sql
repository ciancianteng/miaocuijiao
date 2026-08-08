-- Classified announcement system + ensure legacy pin/publish columns exist.
-- Safe to re-run.

alter table public.announcements add column if not exists is_pinned boolean not null default false;
alter table public.announcements add column if not exists published_at timestamptz;
alter table public.announcements add column if not exists category text not null default 'home';
alter table public.announcements add column if not exists audience text not null default 'home';
alter table public.announcements add column if not exists start_at timestamptz;
alter table public.announcements add column if not exists end_at timestamptz;
alter table public.announcements add column if not exists is_scrolling boolean not null default true;
alter table public.announcements add column if not exists sort_order integer not null default 100;

update public.announcements
set published_at = coalesce(published_at, created_at, now())
where published_at is null;

update public.announcements
set category = coalesce(nullif(trim(category), ''), 'home'),
    audience = coalesce(nullif(trim(audience), ''), 'home')
where true;

update public.announcements
set sort_order = coalesce(sort_order, 100)
where sort_order is null;

create index if not exists idx_announcements_pinned_published
  on public.announcements(is_active, is_pinned desc, published_at desc);

create index if not exists idx_announcements_category_active
  on public.announcements(category, is_active, sort_order asc, published_at desc);

create index if not exists idx_announcements_audience_active
  on public.announcements(audience, is_active);
