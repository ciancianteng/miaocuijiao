-- =============================================================================
-- companion_tags — Production init (DRAFT FOR REVIEW)
-- =============================================================================
-- Target fingerprint (read-only audit): jqfaknpmcnqwqvatrwgo.supabase.co
-- Status: pending-prod — do NOT apply until human review / explicit authorize.
-- Do NOT run staging migration scripts against Production.
--
-- Scope:
--   - CREATE public.companion_tags IF NOT EXISTS
--   - required indexes
--   - seed default taxonomy tags (idempotent)
-- Out of scope:
--   - NO changes to companion_profiles.tags (free-text / hall card field)
--   - NO changes to companion_cert_tags
--   - NO deletes of existing rows
--
-- App behavior until applied:
--   GET /api/platform/content?types=companion_tags falls back to in-memory
--   DEFAULT_TAGS when the table is missing (PGRST205). After apply, DB rows win.
-- =============================================================================

create table if not exists public.companion_tags (
  id text primary key,
  name text not null,
  tag_group text not null default '风格',
  self_selectable boolean not null default true,
  requires_audit boolean not null default false,
  show_in_hall boolean not null default true,
  supports_filter boolean not null default true,
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companion_tags is
  'Companion style/taxonomy tags for admin CRUD + public content API. Independent of companion_profiles.tags free-text.';

create unique index if not exists idx_companion_tags_name
  on public.companion_tags (lower(name));

create index if not exists idx_companion_tags_sort
  on public.companion_tags (sort_order, name);

create index if not exists idx_companion_tags_enabled_sort
  on public.companion_tags (is_enabled, sort_order, name);

-- updated_at helper (shared across pending-prod; safe to re-create)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companion_tags_updated_at on public.companion_tags;
create trigger trg_companion_tags_updated_at
before update on public.companion_tags
for each row execute function public.set_updated_at();

alter table public.companion_tags enable row level security;

-- Public read of enabled tags (service_role bypasses RLS for admin writes)
do $$ begin
  create policy companion_tags_public_read
    on public.companion_tags
    for select
    using (is_enabled = true);
exception when duplicate_object then null;
end $$;

-- Idempotent seed: skip if id OR lower(name) already present (no overwrite).
insert into public.companion_tags (
  id,
  name,
  tag_group,
  self_selectable,
  requires_audit,
  show_in_hall,
  supports_filter,
  sort_order,
  is_enabled
)
select
  v.id,
  v.name,
  v.tag_group,
  true,
  false,
  true,
  true,
  v.sort_order,
  true
from (
  values
    ('ctag-01', '甜妹',     '风格', 1),
    ('ctag-02', '御姐',     '风格', 2),
    ('ctag-03', '猛男',     '风格', 3),
    ('ctag-04', '技术流',   '风格', 4),
    ('ctag-05', '温柔',     '风格', 5),
    ('ctag-06', '活泼',     '风格', 6),
    ('ctag-07', '高冷',     '风格', 7),
    ('ctag-08', '游戏大神', '风格', 8)
) as v(id, name, tag_group, sort_order)
where not exists (
  select 1
  from public.companion_tags existing
  where existing.id = v.id
     or lower(existing.name) = lower(v.name)
);

notify pgrst, 'reload schema';

-- =============================================================================
-- Post-apply verification (human / SQL editor — not executed by this Agent)
-- =============================================================================
-- 1) Table + seed:
--    select id, name, sort_order, is_enabled from public.companion_tags order by sort_order;
--    -- expect >= 8 rows including 甜妹/御姐/猛男/技术流/温柔/活泼/高冷/游戏大神
--
-- 2) Public API (after deploy of this schema):
--    GET /api/platform/content?types=companion_tags
--    -- byType.companion_tags should match DB; no in-memory DEFAULT_TAGS fallback
--
-- 3) Admin CRUD:
--    Admin → 陪玩标签管理 → create/update/disable a tag → reload → persists in DB
--
-- 4) Confirm companion_profiles.tags untouched:
--    -- no column alter; free-text tags behavior unchanged
-- =============================================================================
