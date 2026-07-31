-- Companion levels (full-site shared taxonomy)
create table if not exists public.companion_levels (
  id text primary key,
  level integer not null unique,
  code text not null default '',
  name text not null default '',
  icon text not null default '',
  color text not null default '#9CA3AF',
  display_color text not null default '#9CA3AF',
  card_background text not null default 'solid',
  badge_border text not null default '#9CA3AF',
  badge_text text not null default '#FFFFFF',
  badge_icon text not null default '#9CA3AF',
  min_price numeric(10,2) not null default 0,
  max_price numeric(10,2) not null default 0,
  max_plus boolean not null default false,
  commission_rate numeric(5,2) not null default 20,
  upgrade_condition text not null default '',
  description text not null default '',
  sort_order integer not null default 100,
  is_open boolean not null default true,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companion_levels_sort on public.companion_levels(sort_order, level);

alter table public.companion_levels enable row level security;

do $$ begin
  create policy "companion_levels_public_read"
    on public.companion_levels for select
    using (is_enabled = true);
exception when duplicate_object then null; end $$;

-- Seed defaults (safe upsert)
insert into public.companion_levels (
  id, level, code, name, icon, color, display_color, card_background,
  badge_border, badge_text, badge_icon, min_price, max_price, max_plus,
  commission_rate, upgrade_condition, description, sort_order, is_open, is_enabled
) values
  ('lv1', 1, 'Lv1', '萌喵', '🩶', '#9CA3AF', '#9CA3AF', 'solid', '#9CA3AF', '#E5E7EB', '#D1D5DB', 20, 30, false, 20, '完成基础资料审核并开始接单。', '新加入平台，需要累积订单与评价。', 1, true, true),
  ('lv2', 2, 'Lv2', '灵喵', '💙', '#3B82F6', '#3B82F6', 'gradient', '#60A5FA', '#DBEAFE', '#93C5FD', 30, 40, false, 18, '累计订单与基础好评达到后台设置条件。', '已有订单与基础好评，稳定接单。', 2, true, true),
  ('lv3', 3, 'Lv3', '猎喵', '💜', '#A855F7', '#A855F7', 'gradient', '#C084FC', '#F3E8FF', '#D8B4FE', 40, 45, false, 16, '技术表现、评价和在线时长达到后台设置条件。', '技术表现优秀、评价较高。', 3, true, true),
  ('lv4', 4, 'Lv4', '喵神', '💛', '#EAB308', '#EAB308', 'gradient', '#FACC15', '#FEF9C3', '#FDE047', 60, 75, false, 14, '热门游戏专精表现通过后台审核。', '热门游戏专精陪玩。', 4, false, true),
  ('lv5', 5, 'Lv5', '喵皇', '👑', '#F59E0B', '#EF4444', 'glass', '#F59E0B', '#FEE2E2', '#FBBF24', 75, 100, true, 12, '招牌陪玩、人气主播或大神级资质通过后台审核。', '俱乐部招牌、人气主播或大神级陪玩。', 5, false, true)
on conflict (id) do nothing;
