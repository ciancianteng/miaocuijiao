-- Platform content CMS table (idempotent / re-runnable)

create extension if not exists "pgcrypto";

create table if not exists public.platform_content_items (
  id text primary key,
  type text not null,
  slug text not null,
  title text not null default '',
  status text not null default 'draft',
  enabled boolean not null default true,
  sort integer not null default 100,
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  version integer not null default 0,
  created_by text,
  updated_by text,
  published_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint platform_content_items_type_slug_unique unique (type, slug)
);

do $$
begin
  alter table public.platform_content_items
    drop constraint if exists platform_content_items_status_check;
  alter table public.platform_content_items
    add constraint platform_content_items_status_check
    check (status in ('draft','pending','published','unpublished','disabled'));
exception when others then null;
end $$;

create index if not exists platform_content_items_type_sort_idx
  on public.platform_content_items (type, sort, updated_at desc);

create index if not exists platform_content_items_published_idx
  on public.platform_content_items (type, enabled, status, sort)
  where status = 'published' and enabled = true;

alter table public.platform_content_items enable row level security;

grant select, insert, update, delete on public.platform_content_items to service_role;

-- Club level guide
insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at, published_by, updated_by
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
  1, now(), now(), 'admin', 'admin'
) on conflict (id) do update set
  published = excluded.published,
  draft = excluded.draft,
  status = 'published',
  enabled = true,
  updated_at = now();

-- CS dock reward settings
insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at, published_by, updated_by
) values (
  'pc-cs-dock-reward-settings',
  'cs_dock_reward_settings',
  'default',
  '客服对接奖励设置',
  'published',
  true,
  1,
  jsonb_build_object(
    'enabled', true, 'amountCatFood', 7, 'settleNode', 'paid',
    'clawbackOnRefund', true, 'cancelOnCancel', true, 'oncePerOrder', true, 'dailyCap', 0
  ),
  jsonb_build_object(
    'enabled', true, 'amountCatFood', 7, 'settleNode', 'paid',
    'clawbackOnRefund', true, 'cancelOnCancel', true, 'oncePerOrder', true, 'dailyCap', 0
  ),
  1, now(), now(), 'admin', 'admin'
) on conflict (id) do update set
  published = excluded.published,
  draft = excluded.draft,
  status = 'published',
  enabled = true,
  updated_at = now();

-- Boss / user platform rules (player_rules) — forced ack
insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at, published_by, updated_by
) values (
  'pc-player-rules-platform',
  'player_rules',
  'platform-usage',
  '俱乐部等级与平台使用规则',
  'published',
  true,
  10,
  jsonb_build_object(
    'title', '俱乐部等级与平台使用规则',
    'subtitle', '老板/用户须知 · 后台统一发布',
    'forceConfirm', true,
    'requiresAck', true,
    'version', '1',
    'body', E'一、俱乐部等级\n1. 陪玩等级由后台设定价格区间与升级条件，首页「俱乐部等级说明」实时同步。\n2. 下单价格以陪玩当前等级与服务标价为准，禁止线下议价。\n\n二、下单与支付\n1. 订单金额、时长、优惠由系统计算，支付成功以服务端入账为准。\n2. 待付款订单未支付前可取消；支付后取消/退款需按售后规则处理。\n3. 请勿重复点击下单或支付，系统以幂等键防止重复扣款。\n\n三、服务与沟通\n1. 请通过平台客服与陪玩沟通，禁止引导私下转账或脱离平台交易。\n2. 如需改派、退款或投诉，请在订单页提交，由客服按规则处理。\n\n四、账号安全\n1. 请妥善保管账号，勿将验证码、密码告知他人。\n2. 违规使用、恶意退款或辱骂将被限制下单或封禁。'
  ),
  jsonb_build_object(
    'title', '俱乐部等级与平台使用规则',
    'subtitle', '老板/用户须知 · 后台统一发布',
    'forceConfirm', true,
    'requiresAck', true,
    'version', '1',
    'body', E'一、俱乐部等级\n1. 陪玩等级由后台设定价格区间与升级条件，首页「俱乐部等级说明」实时同步。\n2. 下单价格以陪玩当前等级与服务标价为准，禁止线下议价。\n\n二、下单与支付\n1. 订单金额、时长、优惠由系统计算，支付成功以服务端入账为准。\n2. 待付款订单未支付前可取消；支付后取消/退款需按售后规则处理。\n3. 请勿重复点击下单或支付，系统以幂等键防止重复扣款。\n\n三、服务与沟通\n1. 请通过平台客服与陪玩沟通，禁止引导私下转账或脱离平台交易。\n2. 如需改派、退款或投诉，请在订单页提交，由客服按规则处理。\n\n四、账号安全\n1. 请妥善保管账号，勿将验证码、密码告知他人。\n2. 违规使用、恶意退款或辱骂将被限制下单或封禁。'
  ),
  1, now(), now(), 'admin', 'admin'
) on conflict (id) do update set
  title = excluded.title,
  published = excluded.published,
  draft = excluded.draft,
  status = 'published',
  enabled = true,
  version = greatest(public.platform_content_items.version, 1),
  published_at = coalesce(public.platform_content_items.published_at, now()),
  updated_at = now(),
  published_by = 'admin',
  updated_by = 'admin';

-- Companion apply step-1 institution text (also player_rules)
insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at, published_by, updated_by
) values (
  'pc-player-rules-default',
  'player_rules',
  'apply-step1',
  '陪玩申请制度',
  'published',
  true,
  1,
  jsonb_build_object(
    'title', '陪玩申请制度',
    'subtitle', '申请成为陪玩前必读',
    'forceConfirm', true,
    'requiresAck', true,
    'version', '1',
    'body', E'一、申请须知\n1. 请如实填写资料、上传有效证件与押金凭证。\n2. 通过审核后方可上线接单。\n3. 遵守平台规则与强制公告，违规将影响审核与接单资格。\n\n二、资料与隐私\n1. 身份证、联系方式、结款账户仅本人与授权管理员可查看。\n2. 禁止伪造资料或使用他人证件。'
  ),
  jsonb_build_object(
    'title', '陪玩申请制度',
    'subtitle', '申请成为陪玩前必读',
    'forceConfirm', true,
    'requiresAck', true,
    'version', '1',
    'body', E'一、申请须知\n1. 请如实填写资料、上传有效证件与押金凭证。\n2. 通过审核后方可上线接单。\n3. 遵守平台规则与强制公告，违规将影响审核与接单资格。\n\n二、资料与隐私\n1. 身份证、联系方式、结款账户仅本人与授权管理员可查看。\n2. 禁止伪造资料或使用他人证件。'
  ),
  1, now(), now(), 'admin', 'admin'
) on conflict (id) do update set
  published = excluded.published,
  draft = excluded.draft,
  status = 'published',
  enabled = true,
  updated_at = now();

-- Companion work rules (forceConfirm) — categories
insert into public.platform_content_items (
  id, type, slug, title, status, enabled, sort, draft, published, version, published_at, updated_at, published_by, updated_by
) values
(
  'pc-work-rule-1', 'companion_work_rules', 'rule-1', '接单规则', 'published', true, 1,
  jsonb_build_object('title','接单规则','category','接单规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 上线接单前须确认最新强制规则。\n2. 抢单后须等待老板意向与客服指定，禁止私下承诺。\n3. 接单后须按时开始服务，不得无故拒单。'),
  jsonb_build_object('title','接单规则','category','接单规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 上线接单前须确认最新强制规则。\n2. 抢单后须等待老板意向与客服指定，禁止私下承诺。\n3. 接单后须按时开始服务，不得无故拒单。'),
  1, now(), now(), 'admin', 'admin'
),
(
  'pc-work-rule-2', 'companion_work_rules', 'rule-2', '服务态度', 'published', true, 2,
  jsonb_build_object('title','服务态度','category','服务态度','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 对老板保持礼貌与专业沟通。\n2. 禁止辱骂、冷落、故意消极服务。\n3. 服务质量影响评价、等级与接单资格。'),
  jsonb_build_object('title','服务态度','category','服务态度','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 对老板保持礼貌与专业沟通。\n2. 禁止辱骂、冷落、故意消极服务。\n3. 服务质量影响评价、等级与接单资格。'),
  1, now(), now(), 'admin', 'admin'
),
(
  'pc-work-rule-3', 'companion_work_rules', 'rule-3', '迟到、失联和跳单处理', 'published', true, 3,
  jsonb_build_object('title','迟到、失联和跳单处理','category','迟到、失联和跳单处理','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 无法按时开始须提前告知客服。\n2. 失联、迟到、跳单将按情节扣收益、停权或降级。\n3. 恶意跳单可永久封禁。'),
  jsonb_build_object('title','迟到、失联和跳单处理','category','迟到、失联和跳单处理','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 无法按时开始须提前告知客服。\n2. 失联、迟到、跳单将按情节扣收益、停权或降级。\n3. 恶意跳单可永久封禁。'),
  1, now(), now(), 'admin', 'admin'
),
(
  'pc-work-rule-4', 'companion_work_rules', 'rule-4', '禁止私下交易', 'published', true, 4,
  jsonb_build_object('title','禁止私下交易','category','禁止私下交易','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 禁止引导老板脱离平台付款或加私人联系方式交易。\n2. 发现私下交易将扣回收益并封禁。\n3. 所有结算以平台订单与财务记录为准。'),
  jsonb_build_object('title','禁止私下交易','category','禁止私下交易','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 禁止引导老板脱离平台付款或加私人联系方式交易。\n2. 发现私下交易将扣回收益并封禁。\n3. 所有结算以平台订单与财务记录为准。'),
  1, now(), now(), 'admin', 'admin'
),
(
  'pc-work-rule-5', 'companion_work_rules', 'rule-5', '退款及投诉规则', 'published', true, 5,
  jsonb_build_object('title','退款及投诉规则','category','退款及投诉规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 退款由客服/后台审核，禁止私下承诺退款结果。\n2. 因陪玩责任导致退款，已发收益可按规则扣回。\n3. 对投诉须配合说明，不得威胁或报复老板。'),
  jsonb_build_object('title','退款及投诉规则','category','退款及投诉规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 退款由客服/后台审核，禁止私下承诺退款结果。\n2. 因陪玩责任导致退款，已发收益可按规则扣回。\n3. 对投诉须配合说明，不得威胁或报复老板。'),
  1, now(), now(), 'admin', 'admin'
),
(
  'pc-work-rule-6', 'companion_work_rules', 'rule-6', '账号处罚规则', 'published', true, 6,
  jsonb_build_object('title','账号处罚规则','category','账号处罚规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 违规可视情节警告、扣猫粮收益、降级、停权或封号。\n2. 处罚记录由后台留存，陪玩须遵守处理结果。\n3. 多次违规将限制提现与接单。'),
  jsonb_build_object('title','账号处罚规则','category','账号处罚规则','forceConfirm',true,'requiresAck',true,'version','1','body',E'1. 违规可视情节警告、扣猫粮收益、降级、停权或封号。\n2. 处罚记录由后台留存，陪玩须遵守处理结果。\n3. 多次违规将限制提现与接单。'),
  1, now(), now(), 'admin', 'admin'
)
on conflict (id) do update set
  title = excluded.title,
  published = excluded.published,
  draft = excluded.draft,
  status = 'published',
  enabled = true,
  sort = excluded.sort,
  updated_at = now(),
  published_by = 'admin',
  updated_by = 'admin';

notify pgrst, 'reload schema';
