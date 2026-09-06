-- =============================================================================
-- G2 SQL REVIEW — 标记 10 个 smoke/test 账号（只生成 / 不执行）
-- =============================================================================
-- 状态：REVIEW ONLY — 禁止对本文件执行 Production UPDATE
-- 依据：SMOKE_TEST_ISOLATION_DESIGN.md §1.1 + convert-admin verify
-- 更新：2026-09-06 — 已从 mark 列表移除真实 admin UUID
--       6f31b706-11e7-42df-8db1-d2caccd796de = meowcuijiao@gmail.com（正式 admin，勿标 test）
-- 前置：G1 / convert D0+D1 ✅ 已应用（列存在；真实 admin is_test_account=false）
-- G2 Production UPDATE：❌ BLOCKED（需单独 EXECUTE G2 批准）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) 已排除（正式 admin — 勿写入下方 IN 列表）
-- ---------------------------------------------------------------------------
-- | id | email | role | note |
-- | 6f31b706-11e7-42df-8db1-d2caccd796de | meowcuijiao@gmail.com | admin | CONVERT VERIFY SUCCESS; keep false |

-- ---------------------------------------------------------------------------
-- 1) 10 个 smoke/test account id / email
-- ---------------------------------------------------------------------------
-- | # | id | email | role | display_name |
-- |---|---|---|---|---|
-- | 1 | b989960b-ddc2-4f1b-899f-12b2b0cac3b7 | boss@meow.test | boss | P0 Boss |
-- | 2 | d397b7bb-826b-4e7a-8fdf-f14602dd92bb | boss.final.1785714993009@meow.test | boss | Boss Final |
-- | 3 | 5f20a7fe-3a48-4b42-82b9-82222bc81311 | cs.smoke.1788374622374@meow.test | customer_service | ProdSmokeCS |
-- | 4 | 47178368-a3d4-44b3-97fe-8a648d951c66 | brnwxnfv@guerrillamailblock.com | companion | ProdSmokeInviter |
-- | 5 | ed5054bd-93d2-434a-b468-68f75423d830 | swrfscrd@guerrillamailblock.com | companion | ProdSmokeService |
-- | 6 | 779db97b-9a5d-4a97-8be8-5d7bc6d24109 | qemvmuma@guerrillamailblock.com | boss | ProdSmokeBoss |
-- | 7 | b9347ea4-3b45-400d-bf8d-ae2fbe05d690 | cs.smoke.1788374831089@meow.test | customer_service | ProdSmokeCS |
-- | 8 | 6d368f4b-7f33-4923-9441-c63cecef2070 | shjqelap@guerrillamailblock.com | companion | ProdSmokeInviter2 |
-- | 9 | 9f7fb39a-bec8-47cc-974a-e314ac2f5cd5 | uuzkxxgk@guerrillamailblock.com | companion | ProdSmokeService2 |
-- | 10 | 0664ef55-de58-48e3-8dbb-ca8111318e91 | ijogepcg@guerrillamailblock.com | boss | ProdSmokeBoss2 |

-- ---------------------------------------------------------------------------
-- 2) 精确 UPDATE（未来授权后执行；本轮不执行）
-- ---------------------------------------------------------------------------

begin; -- review only; do not run on Production without approval

update public.profiles
set is_test_account = true
where id in (
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

-- 核验（期望 profiles marked = 10；真实 admin false）
-- select count(*) filter (where is_test_account) as marked,
--        count(*) filter (where not is_test_account) as unmarked
-- from public.profiles;
-- select id, role, email, display_name, is_test_account
-- from public.profiles
-- where is_test_account = true
-- order by role, email;
-- select id, email, role, is_test_account
-- from public.profiles
-- where id = '6f31b706-11e7-42df-8db1-d2caccd796de';
-- expect: meowcuijiao@gmail.com / admin / false

rollback; -- REVIEW TEMPLATE ends with rollback; real apply must be explicit COMMIT after 核验

-- ---------------------------------------------------------------------------
-- 3) 影响范围（不删除任何行）
-- ---------------------------------------------------------------------------
-- 账号：10 profiles 布尔标记 true；正式 admin 6f31b706-… 保持 false。
-- companion_profiles：与上述 user_id 绑定的行镜像 true（约 4 条 smoke companion）。
-- 订单：不 UPDATE / 不 DELETE。受影响业务语义：
--   • MCJO000344 completed / RM 6000（boss_id=0664ef55-... / companion_id=9f7fb39a-...）
--     → Dashboard GMV / 佣金 / 积分排除
--   • 其他 smoke 触达订单 → 同上
--   • 正式候选订单（双方非 test）→ 不受本 UPDATE 影响
-- Admin：真实 admin meowcuijiao@gmail.com 不在 mark 列表。
-- 大厅/列表：依赖 is_test_account 的上架门禁将对 smoke companion 生效。
-- 结算/积分：代码 fail-closed 跳过 test-touched（即使误开 flag）。

-- ---------------------------------------------------------------------------
-- 4) 本轮状态
-- ---------------------------------------------------------------------------
-- CONVERT VERIFY：✅ login meowcuijiao@gmail.com OK；boss unchanged
-- D0/D1 (G1 column)：✅ APPLIED（admin false；0 marked pre-G2）
-- G2 SQL review（10 ids，已排除正式 admin）：✅
-- G2 Production UPDATE：❌ 未执行（BLOCKED：需单独批准）
-- =============================================================================
