-- Rules hub acks — resilient when companion_levels missing

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'companion_levels'
  ) then
    alter table public.companion_levels add column if not exists requirements text not null default '';
    alter table public.companion_levels add column if not exists downgrade_condition text not null default '';
    alter table public.companion_levels add column if not exists benefits text not null default '';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'announcements'
  ) then
    alter table public.announcements add column if not exists kind text not null default 'normal';
    alter table public.announcements add column if not exists content_version integer not null default 1;
    alter table public.announcements add column if not exists requires_ack boolean not null default false;
    update public.announcements
      set kind = coalesce(nullif(trim(kind), ''), 'normal')
      where true;
    update public.announcements
      set requires_ack = true
      where kind = 'forced' and requires_ack = false;
    create index if not exists idx_announcements_kind_active
      on public.announcements(kind, is_active, audience);
  end if;
end $$;

create table if not exists public.content_ack_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null,
  content_id text not null,
  content_version text not null,
  status text not null default 'acked'
    check (status in ('acked', 'pending', 'expired', 'revoked')),
  acknowledged_at timestamptz,
  effective_at timestamptz,
  content_updated_at timestamptz,
  ip text,
  user_agent text,
  revoked boolean not null default false,
  expired boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_ack_records_unique unique (user_id, content_type, content_id, content_version)
);

create index if not exists idx_content_ack_user
  on public.content_ack_records (user_id, content_type, acknowledged_at desc);

create index if not exists idx_content_ack_content
  on public.content_ack_records (content_type, content_id, content_version);

alter table public.content_ack_records enable row level security;

create table if not exists public.companion_penalties (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  rule_id text,
  order_id uuid references public.orders(id) on delete set null,
  evidence text not null default '',
  penalty_type text not null
    check (penalty_type in ('warn', 'deduct_catfood', 'demote', 'suspend', 'ban')),
  amount_cat_food numeric(12,2) default 0,
  note text not null default '',
  operator_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companion_penalties_companion
  on public.companion_penalties (companion_id, created_at desc);

alter table public.companion_penalties enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'platform_content_items'
  ) then
    insert into public.platform_content_items (
      id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at
    ) values (
      'pc-club-level-guide',
      'club_level_guide',
      'default',
      '俱乐部等级说明',
      'published',
      true,
      1,
      jsonb_build_object(
        'title', '俱乐部等级说明',
        'intro', '了解妙脆角俱乐部陪玩等级、价格区间、升级与权益。内容由后台维护，前台实时同步。'
      ),
      jsonb_build_object(
        'title', '俱乐部等级说明',
        'intro', '了解妙脆角俱乐部陪玩等级、价格区间、升级与权益。内容由后台维护，前台实时同步。'
      ),
      1,
      now(),
      now()
    )
    on conflict (id) do nothing;
  end if;
exception when others then
  null;
end $$;
