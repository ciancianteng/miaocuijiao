-- =============================================================================
-- G2 SQL REVIEW — 标记 11 个 smoke/test 账号（只生成 / 不执行）
-- =============================================================================
-- 状态：REVIEW ONLY — 禁止对本文件执行 Production UPDATE
-- 依据：SMOKE_TEST_ISOLATION_DESIGN.md §1.1
-- 只读复核（2026-09-05）：下列 11 个 id 均存在于 Production profiles
-- 前置：必须先完成 G1（列存在）且 G3 已有真实非 test admin（避免锁死后台）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) 11 个 test account id / email（Production 只读已核对）
-- ---------------------------------------------------------------------------
-- | # | id | email | role | display_name |
-- |---|---|---|---|---|
-- | 1 | 6f31b706-11e7-42df-8db1-d2caccd796de | admin@meow.test | admin | Admin |
-- | 2 | b989960b-ddc2-4f1b-899f-12b2b0cac3b7 | boss@meow.test | boss | P0 Boss |
-- | 3 | d397b7bb-826b-4e7a-8fdf-f14602dd92bb | boss.final.1785714993009@meow.test | boss | Boss Final |
-- | 4 | 5f20a7fe-3a48-4b42-82b9-82222bc81311 | cs.smoke.1788374622374@meow.test | customer_service | ProdSmokeCS |
-- | 5 | 47178368-a3d4-44b3-97fe-8a648d951c66 | brnwxnfv@guerrillamailblock.com | companion | ProdSmokeInviter |
-- | 6 | ed5054bd-93d2-434a-b468-68f75423d830 | swrfscrd@guerrillamailblock.com | companion | ProdSmokeService |
-- | 7 | 779db97b-9a5d-4a97-8be8-5d7bc6d24109 | qemvmuma@guerrillamailblock.com | boss | ProdSmokeBoss |
-- | 8 | b9347ea4-3b45-400d-bf8d-ae2fbe05d690 | cs.smoke.1788374831089@meow.test | customer_service | ProdSmokeCS |
-- | 9 | 6d368f4b-7f33-4923-9441-c63cecef2070 | shjqelap@guerrillamailblock.com | companion | ProdSmokeInviter2 |
-- | 10 | 9f7fb39a-bec8-47cc-974a-e314ac2f5cd5 | uuzkxxgk@guerrillamailblock.com | companion | ProdSmokeService2 |
-- | 11 | 0664ef55-de58-48e3-8dbb-ca8111318e91 | ijogepcg@guerrillamailblock.com | boss | ProdSmokeBoss2 |

-- ---------------------------------------------------------------------------
-- 2) 精确 UPDATE（未来授权后执行；本轮不执行）
-- ---------------------------------------------------------------------------

begin; -- review only; do not run on Production without approval

update public.profiles
set is_test_account = true
where id in (
  '6f31b706-11e7-42df-8db1-d2caccd796de',
  'b989960b-ddc2-4f1b-899f-12b2b0cac3b7',
  'd397b7bb-826b-4e7a-8fdf-f14602dd92bb',
  '5f20a7fe-3a48-4b42-82b9-82222bc81311',
  '47178368-a3d4-44b3-97fe-8a648d951c66',
  'ed5054bd-93d2-434a-b468-68f75423d830',
  '779db97b-9a5d-4a97-8be8-5d7bc6d24109',
  'b9347ea4-3b45-400d-bf8d-ae2fbe05d690',
  '6d368f4b-7f33-4923-9441-c63cecef2070',
  '9f7fb39a-bec8-47cc-974a-e314ac2f5cd5',
  '0664ef55-de58-48e3-8dbb-ca8111318e91'
);

-- companion 镜像（仅上述 user_id；无 companion_profiles 行则 0 行更新）
update public.companion_profiles
set is_test_account = true
where user_id in (
  '6f31b706-11e7-42df-8db1-d2caccd796de',
  'b989960b-ddc2-4f1b-899f-12b2b0cac3b7',
  'd397b7bb-826b-4e7a-8fdf-f14602dd92bb',
  '5f20a7fe-3a48-4b42-82b9-82222bc81311',
  '47178368-a3d4-44b3-97fe-8a648d951c66',
  'ed5054bd-93d2-434a-b468-68f75423d830',
  '779db97b-9a5d-4a97-8be8-5d7bc6d24109',
  'b9347ea4-3b45-400d-bf8d-ae2fbe05d690',
  '6d368f4b-7f33-4923-9441-c63cecef2070',
  '9f7fb39a-bec8-47cc-974a-e314ac2f5cd5',
  '0664ef55-de58-48e3-8dbb-ca8111318e91'
);

-- 核验（期望 profiles marked = 11）
-- select count(*) filter (where is_test_account) as marked,
--        count(*) filter (where not is_test_account) as unmarked
-- from public.profiles;
-- select id, role, email, display_name, is_test_account
-- from public.profiles
-- where is_test_account = true
-- order by role, email;

rollback; -- REVIEW TEMPLATE ends with rollback; real apply must be explicit COMMIT after 核验

-- ---------------------------------------------------------------------------
-- 3) 影响范围（不删除任何行）
-- ---------------------------------------------------------------------------
-- 账号：11 profiles 布尔标记 true；其余正式候选保持 false。
-- companion_profiles：与上述 user_id 绑定的行镜像 true（约 4 条 smoke companion）。
-- 订单：不 UPDATE / 不 DELETE。受影响业务语义：
--   • MCJO000344 completed / RM 6000（boss_id=0664ef55-... / companion_id=9f7fb39a-...）
--     → Dashboard GMV / 佣金 / 积分排除
--   • 其他 smoke 触达订单 → 同上
--   • 正式候选订单（双方非 test）→ 不受本 UPDATE 影响
-- Admin：admin@meow.test 将被标 test；**必须先有真实 admin（G3）**再执行。
-- 大厅/列表：依赖 is_test_account 的上架门禁将对 smoke companion 生效。
-- 结算/积分：代码 fail-closed 跳过 test-touched（即使误开 flag）。

-- ---------------------------------------------------------------------------
-- 4) 本轮状态
-- ---------------------------------------------------------------------------
-- G2 SQL review + 影响范围：✅
-- G2 Production UPDATE：❌ 未执行（需批准；且依赖 G1+G3）
-- =============================================================================
