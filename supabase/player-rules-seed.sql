-- Seed / upsert companion apply rules (player_rules) for launch.
-- Run in Supabase SQL editor if platform_content_items has no published player_rules yet.

insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort,
  draft, published, version, published_by, published_at, updated_by, updated_at, created_at
) values (
  'pc-player-rules-launch',
  'player_rules',
  'companion-apply-rules',
  'Meow Cui Jiao 陪玩申请制度',
  'published',
  true,
  100,
  jsonb_build_object(
    'title', 'Meow Cui Jiao 陪玩申请制度',
    'body', E'1. 礼貌服务，尊重老板和客服。\n2. 准时上线，按订单时间完成服务。\n3. 禁止私下交易、诱导转账或索取额外财物。\n4. 禁止泄露老板、陪玩、客服和平台隐私。\n5. 服务中如遇争议，请第一时间联系平台客服处理。',
    'versionNote', 'v2026.08.02',
    'notes', '申请资料必须真实、清楚、可审核。头像、卡面、试音和游戏资料通过后才会展示到前台。',
    'penaltyRules', '违规会根据情节进行警告、暂停接单、扣除保证金、封禁账号或移交进一步处理。',
    'depositRules', '身份认证、押金和结款资料会在最终提交时一并进入后台审核。',
    'sort', 100
  ),
  jsonb_build_object(
    'title', 'Meow Cui Jiao 陪玩申请制度',
    'body', E'1. 礼貌服务，尊重老板和客服。\n2. 准时上线，按订单时间完成服务。\n3. 禁止私下交易、诱导转账或索取额外财物。\n4. 禁止泄露老板、陪玩、客服和平台隐私。\n5. 服务中如遇争议，请第一时间联系平台客服处理。',
    'versionNote', 'v2026.08.02',
    'notes', '申请资料必须真实、清楚、可审核。头像、卡面、试音和游戏资料通过后才会展示到前台。',
    'penaltyRules', '违规会根据情节进行警告、暂停接单、扣除保证金、封禁账号或移交进一步处理。',
    'depositRules', '身份认证、押金和结款资料会在最终提交时一并进入后台审核。',
    'sort', 100
  ),
  1,
  'super_admin',
  now(),
  'super_admin',
  now(),
  now()
)
on conflict (id) do update set
  title = excluded.title,
  status = 'published',
  enabled = true,
  draft = excluded.draft,
  published = excluded.published,
  version = coalesce(platform_content_items.version, 0) + 1,
  published_by = excluded.published_by,
  published_at = now(),
  updated_by = excluded.updated_by,
  updated_at = now();
