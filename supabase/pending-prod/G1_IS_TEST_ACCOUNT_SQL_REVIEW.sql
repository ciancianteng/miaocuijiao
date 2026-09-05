-- =============================================================================
-- G1 SQL REVIEW — profiles.is_test_account 字段方案（只生成 / 不执行）
-- =============================================================================
-- 状态：REVIEW ONLY
-- 来源 SoT：supabase/migrations/20260903_profiles_is_test_account.sql
-- 现网 profiles schema（只读 2026-09-05）：无 is_test_account 列
--   现有列样例：id, role, email, display_name, status, phone, avatar_url, boss_uid, ...
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) 当前结论
-- ---------------------------------------------------------------------------
-- • Production profiles 无 is_test_account
-- • companion_profiles 无 is_test_account（表本身存在）
-- • 默认值要求：NOT NULL DEFAULT false → 加列后既有行全部为 false（不误标）

-- ---------------------------------------------------------------------------
-- 2) 建议 DDL（与仓库 migration 一致；本轮不 apply）
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

alter table public.companion_profiles
  add column if not exists is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'When true, exclude from production business dashboard stats. Set by ops; never auto-delete.';

comment on column public.companion_profiles.is_test_account is
  'When true, companion is a test/smoke fixture and must not appear in business metrics.';

create index if not exists idx_profiles_is_test_account
  on public.profiles (is_test_account)
  where is_test_account = true;

-- ---------------------------------------------------------------------------
-- 3) 回填占位（精确 id 回填见 G2；此处仅说明默认值语义）
-- ---------------------------------------------------------------------------
-- 加列后、未跑 G2 时：
--   select count(*) filter (where is_test_account) as marked,
--          count(*) filter (where not is_test_account) as unmarked
--   from public.profiles;
-- 期望：marked = 0。
-- **禁止**在本文件用启发式批量 UPDATE；必须用 G2 的 11 个 id 精确列表。

-- ---------------------------------------------------------------------------
-- 4) 默认值 false 确认
-- ---------------------------------------------------------------------------
-- ADD COLUMN ... boolean not null default false
-- → PostgreSQL 对既有行填充 false；新插入未显式指定时亦为 false。
-- → 正式账号不会因加列被标为 test。

-- ---------------------------------------------------------------------------
-- 5) 本轮状态
-- ---------------------------------------------------------------------------
-- G1 方案 + SQL review：✅
-- G1 Production apply：❌ 未执行（需批准）
-- =============================================================================
