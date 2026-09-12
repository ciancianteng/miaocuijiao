# DESIGN v2：直属邀请 / 返点（按邀请人身份分型）

> **Status:** design-only（本 PR 仅文档，不实现、不 Merge）  
> **锁死原则：** 返点类型由 **`inviter_type`（邀请人身份）** 决定，**永远不**由被邀请人当前身份决定。  
> **隔离：** 不改 Hall UI / #222 / 首页热门推荐 / Web Push / Pricing / Order 核心 / Auth / DB 实现。

---

## 0. 最终业务规则（已锁死）

### 0.1 两套奖励

| 邀请人身份 `inviter_type` | 返点产物 | 是否可提现 | 账户 |
|---------------------------|----------|------------|------|
| `boss` / `user`（老板 / 普通用户） | **喵币** | **否** | 喵币 Ledger → 喵币余额 → 仅平台消费 |
| `companion`（已审核陪玩） | **现金** | **是**（满足结算规则后） | Referral Cash Ledger → 可结算余额 → 提现 |

### 0.2 四种矩阵（必须全部支持）

| 邀请人 → 被邀请人 | 奖励类型 | 可提现 |
|-------------------|----------|--------|
| 老板 → 老板 / 普通用户 | 喵币 | 否 |
| 老板 → 陪玩（含：先注册后成为陪玩） | 喵币 | 否 |
| 陪玩 → 老板 / 普通用户 | 现金 | 是 |
| 陪玩 → 陪玩（含：先注册后成为陪玩） | 现金 | 是 |

伪代码（唯一合法判定）：

```text
if inviter_type in (boss, user):
    reward_type = meow_coin
    withdrawable = false
elif inviter_type == companion:
    reward_type = cash
    withdrawable = true
else:
    reject / no reward path
# NEVER branch on invitee_type for reward_type
```

### 0.3 绑定与身份变化

- 链接 → 注册 → 展示邀请人资料 → 用户主动「确认绑定」→ 才建立直属。
- **禁止偷偷绑定。**
- 一用户原则上 **只有一个** 直属邀请人；已绑定后新链接 **不可覆盖**。
- 被邀请人日后申请陪玩 / 角色升级：**不得改变** `inviter_*`；直属关系永久保留邀请来源。

### 0.4 返点触发

- 建立直属 **本身不产生** 奖励。
- 仅直属用户产生的 **真实有效完成订单** 才计算返点。
- 创建 / 仅支付暂存 / 取消 / 测试单 / 退款：不最终入账；已入账则冲正。
- 同一订单对同一邀请关系 **幂等只返一次**（冲正另记）。

### 0.5 与现有「运营直属分成」正交

现有 `boss_companion_relations` + `boss_commission = platform_fee * rate` 是 **运营直属陪玩分成**（老板从平台抽成中拿分成）。

本设计的 **邀请返点** 是另一条经济线：

| | 运营直属分成（已有） | 邀请返点（本设计） |
|--|---------------------|-------------------|
| 关系表 | `boss_companion_relations` | 新 `direct_invite_relations` |
| 谁拿钱 | 必须是 boss，且对方是 companion | 看 `inviter_type` |
| 产物 | 老板佣金（现有 earnings） | 喵币 **或** 现金 referral |
| 是否覆盖 4 矩阵 | 仅 boss→companion | 四矩阵全覆盖 |

**实现阶段禁止把邀请返点写进 `boss_commission_earnings`，也禁止把老板邀请返点写成可提现现金。**

---

## 1. 现有 Boss invite 系统：可复用什么

| 资产 | 路径 | 复用方式 |
|------|------|----------|
| 邀请码生成 / URL | `server/api/_boss-invite-links.js` | 抽成通用 `invite_links` 服务；老板/陪玩共用码空间或分前缀 |
| 公开解析落地页 | `invite.html` + `resolve` | 扩展为识别 `inviter_type`，展示邀请人资料 +「确认绑定」 |
| 兑换审计 | `boss_invite_redemptions` | 模式可复用（append-only outcome）；表需泛化为任意 invitee，不限 companion |
| 功能开关 | `BOSS_INVITE_LINKS_ENABLED` | 拆/扩为 `DIRECT_INVITE_ENABLED`；旧 flag 过渡期兼容 |
| 幂等钱包入账模式 | `wallet_transactions.idempotency_key` / `mcj_wallet_credit` | **模式**复用到喵币 ledger；不直接 `balance +=` |
| 订单完成钩子 | `_order-complete.js` | 在「有效完成」后追加邀请返点结算调用（独立模块） |
| 陪玩提现管道 | `companion_withdrawals` / finance | 现金 referral **结算后**可并入或平行进入陪玩可提现余额（见 §5） |
| Admin 关系 UI 骨架 | `admin-boss-companion-relations.js` | 仅作交互参考；新模块独立，不塞进运营关系页硬改 |

**不可直接复用为 SoT 的：**

- `boss_companion_relations`（角色钉死 boss/companion，且唯一 active companion→boss）
- `boss_commission_earnings`（platform_fee 分成，非邀请返点）
- `companion_profiles.direct_rebate_rate`（挂在被邀请/陪玩身上的旧「直属陪返点」，与 `inviter_type` 模型冲突）
- 本地 `commission-engine.js` / unified-config 里的 stub `referral_*`（无 SQL SoT）

---

## 2. 为什么 `boss_companion_relations` 不足以承担全部直属邀请

1. **列语义固定**：`boss_id` + `companion_id`，绑定前校验 `hasBossRole` / `hasCompanionRole` → 无法表达 boss→boss、companion→companion、companion→boss。
2. **基数约束**：`uq_boss_companion_relations_active_companion` 强制「一个陪玩最多一个运营老板」，不能表达「任意用户一个邀请人」的邀请图（邀请人可以是陪玩）。
3. **经济绑定错误**：该表 `commission_rate` 驱动的是 **platform_fee 运营分成**，不是「邀请人拿喵币/现金」。
4. **身份变化**：陪玩运营关系可 rebind/unbind；邀请来源必须 **永久冻结** `inviter_type_at_binding`，二者生命周期不同。
5. **邀请码归属**：现网 `boss_invite_links` 只挂 `boss_id`；陪玩专属链接无处存放。

结论：保留 `boss_companion_relations` 作运营关系；新建 **邀请直属** 关系与双 ledger。

---

## 3. 新直属关系 Schema（建议）

### 3.1 `invite_links`（通用专属邀请链接）

```text
invite_links
  id uuid PK
  owner_user_id uuid NOT NULL → profiles
  owner_type text NOT NULL CHECK (owner_type IN ('boss','user','companion'))
      -- 创建时快照；陪玩链接仅 approved companion 可建
  code text NOT NULL UNIQUE  -- len>=8
  status text NOT NULL CHECK (status IN ('active','revoked','exhausted'))
  max_uses int NULL
  use_count int NOT NULL DEFAULT 0
  expires_at timestamptz NULL
  label text NULL
  created_at / updated_at
```

- 老板/普通用户、已审核陪玩各有自己的专属链接。
- 过渡：可将现有 `boss_invite_links` **迁移/视图兼容** 进本表（`owner_type='boss'`）。

### 3.2 `direct_invite_relations`（直属邀请关系 SoT）

```text
direct_invite_relations
  id uuid PK
  inviter_user_id uuid NOT NULL → profiles
  inviter_type_at_binding text NOT NULL
      CHECK (IN ('boss','user','companion'))
  invitee_user_id uuid NOT NULL → profiles
  invitee_type_at_binding text NOT NULL
      CHECK (IN ('boss','user','companion','unknown'))
  invite_code text NOT NULL
  invite_link_id uuid NULL → invite_links
  source text NOT NULL  -- e.g. link_share | admin | import
  status text NOT NULL CHECK (IN ('pending','active','revoked'))
      -- pending: 已识别邀请人、待用户确认；active: 已确认
  confirmed_at timestamptz NULL
  created_at / updated_at

  CONSTRAINT not_self CHECK (inviter_user_id <> invitee_user_id)
```

**关键约束（防重复绑定）：**

```text
UNIQUE (invitee_user_id) WHERE status = 'active'
-- 一用户只能有一个有效直属邀请人
```

可选：`UNIQUE (invitee_user_id) WHERE status = 'pending'` 或「同 invitee 只能有一个非终态 pending」。

**冻结字段：** `inviter_user_id` / `inviter_type_at_binding` 在 `active` 后 **禁止 UPDATE**（仅 admin revoke 改 status；不改邀请人）。

### 3.3 `direct_invite_events`（append-only）

`recognized | confirm_bind | reject | revoke | blocked_already_bound | identity_snapshot`

含 operator、payload（当时展示的邀请人资料、客户端等）。

### 3.4 身份变化时的规则

```text
用户 C 经老板 A 确认绑定 → relation.active
  inviter = A, inviter_type_at_binding = boss
C 日后申请陪玩通过：
  - 更新 profiles / companion_profiles 即可
  - 禁止改 direct_invite_relations.inviter_*
  - invitee「当前身份」仅查询时 join，不回写绑定快照
  - 返点仍按 inviter_type_at_binding = boss → 喵币
```

运营表 `boss_companion_relations` 若需「A 成为 C 的运营老板」：**另走运营绑定流程**，不得静默用邀请关系覆盖，也不得反向改邀请人。

---

## 4. 喵币 Ledger 如何接（老板 / 用户邀请人）

### 4.1 账户与流水

```text
meow_coin_accounts
  user_id uuid PK → profiles
  balance numeric(12,2) NOT NULL DEFAULT 0  -- >=0
  updated_at

meow_coin_ledger
  id uuid PK
  user_id uuid NOT NULL
  direction text CHECK (IN ('credit','debit','reversal'))
  amount numeric(12,2) NOT NULL CHECK (amount > 0)
  balance_after numeric(12,2) NOT NULL
  entry_type text NOT NULL
      -- referral_reward | referral_reversal | spend | adjust_admin
  order_id uuid NULL
  relation_id uuid NULL → direct_invite_relations
  idempotency_key text NOT NULL UNIQUE
  meta jsonb
  created_at
```

### 4.2 规则

- **仅** `inviter_type_at_binding ∈ {boss,user}` 的返点写入本 ledger。
- **不可提现**；消费走平台下单/充值抵扣等 debit（实现阶段再接支付路由）。
- 禁止直接 `UPDATE meow_coin_accounts SET balance = balance + $x` 无 ledger。
- 与 `wallets` / 猫粮 **逻辑隔离**。若产品要把「喵币」展示为猫粮赠币：只能通过 **受控兑换/镜像入账**（另一笔带 idempotency 的 wallet tx），默认建议 **独立展示「喵币」**，避免与 `paid_balance` 混淆。

### 4.3 和现有点的关系

- `user_points_*`（积分）≠ 喵币；本设计不复用积分倍率。
- Admin 文案里偶发「喵币」应对齐到本账户，而不是 `boss_commission_earnings`。

---

## 5. 现金 Referral Ledger 如何接（陪玩邀请人）

### 5.1 账户与流水

```text
referral_cash_accounts
  user_id uuid PK → profiles  -- 预期为 companion
  available_balance numeric(12,2) NOT NULL DEFAULT 0  -- 可申请结算
  pending_balance numeric(12,2) NOT NULL DEFAULT 0   -- 可选：待过结算窗
  lifetime_earned / lifetime_reversed / lifetime_paid
  updated_at

referral_cash_ledger
  id uuid PK
  user_id uuid NOT NULL
  direction text CHECK (IN ('credit','debit','reversal','payout'))
  amount numeric(12,2) NOT NULL CHECK (amount > 0)
  balance_after_available numeric(12,2) NOT NULL
  entry_type text NOT NULL
      -- referral_reward | referral_reversal | settle_to_withdraw | payout | adjust_admin
  order_id uuid NULL
  relation_id uuid NULL
  idempotency_key text NOT NULL UNIQUE
  meta jsonb  -- rate, base_amount, reward_type=cash, inviter_type
  created_at
```

### 5.2 结算 / 提现

- 满足平台结算规则后：`settle_to_withdraw` 转入陪玩既有提现可用额（或生成 `companion_withdrawals` 可合并来源）。
- **不得** 把老板邀请返点写入本表。
- **不得** 与 `boss_commission_earnings` 混账。

### 5.3 订单完成挂钩

在订单进入「有效完成」且通过测试单过滤后：

1. 查 invitee 的 `direct_invite_relations` where `status=active`
2. 读冻结的 `inviter_type_at_binding`
3. 取对应 rate（§10）
4. 计算 `reward = base * rate`（基数见开放项）
5. 按类型写入喵币或现金 ledger（`idempotency_key = referral:{order_id}:{relation_id}`）

---

## 6. 用户升级 / 申请成陪玩后如何保持原直属

1. 绑定快照字段永不因角色变更而 rewrite。
2. Admin / 陪玩详情展示「当前身份」用 live join；「绑定身份」用 snapshot。
3. 返点判定 **只读** `inviter_type_at_binding`。
4. 若 C 成为陪玩后另有人想当运营老板：走 `boss_companion_relations`，与邀请返点并行，互不覆盖。
5. 禁止「成为陪玩时自动把邀请人写成运营 boss」的静默逻辑（可做 **显式** 建议绑定，需二次确认 + admin reason）。

---

## 7. 防重复绑定

| 层 | 机制 |
|----|------|
| DB | partial unique `active` per `invitee_user_id` |
| API confirm | 若已 active → `409 already_bound`，不改邀请人 |
| 新链接访问 | 已绑定用户可看邀请页，但 CTA 为「你已有直属邀请人」，无确认按钮 |
| pending | 新码可刷新 pending 的邀请人候选 **仅当尚未 confirm**；confirm 后锁定 |
| 兑换审计 | `direct_invite_events` 记 `blocked_already_bound` |
| 旧 boss redeem | 迁移期：`redeemInviteAfterCompanionReady` 不得再静默 `bindRelation` 充当邀请 SoT；改为走确认绑定 |

---

## 8. 防重复返点

| 层 | 机制 |
|----|------|
| Ledger | `idempotency_key UNIQUE` = `referral:{order_id}:{relation_id}` |
| 业务 | 结算前查是否已有 `referral_reward` credit；有则 skip |
| 订单 | 可选 snapshot 列 `invite_referral_reward_id` / status（便于对账，非唯一依赖） |
| 并发 | 事务内先插 ledger（或 advisory lock on order_id） |
| 测试单 | `is_test` / purge 标记订单直接 skip |

---

## 9. 退款冲正

```text
on refund finalized (or cancel-after-complete if ever allowed):
  find referral_reward credit by order_id
  if none: no-op
  if already reversed: no-op (idempotent)
  insert reversal entry
    idempotency_key = referral_reversal:{order_id}:{relation_id}
    amount = original credit
    direction = reversal
  decrease meow_coin / referral_cash balance
  if cash already settled/paid out: mark clawback_debt or block future payout（策略在实现前确认）
```

- 支付成功但未完成：不发最终返点（避免先发后撤噪声）；若未来有「支付即预提」，必须进 `pending_balance` 且支付撤销时回滚。
- **本设计默认：仅有效完成才 credit。**

---

## 10. 后台返点比例设置

**禁止** 单一 `referral_rate`。

```text
platform_settings.data (或独立 referral_settings 表)
  boss_referral_rate        numeric  -- 老板/用户邀请 → 喵币；单位 %
  companion_referral_rate   numeric  -- 陪玩邀请 → 现金；单位 %
  referral_rebate_base      enum     -- 见开放项：建议 paid_amount
  referral_enabled          bool
```

- 两边比例互相独立，不写死 5%。
- 计算时用订单完成瞬间的 rate **快照** 写入 ledger.meta / order snapshot，防事后改比例扯皮。
- **不要** 用 `companion_profiles.direct_rebate_rate` 作为邀请返点 SoT（语义是旧的「从陪玩收入扣」）。

关系级 override（可选，二期）：`direct_invite_relations.reward_rate_override`；一期可只用全局两档。

---

## 11. 老板端「我的邀请」

入口建议：`mine` / 现「直属分成中心」旁 **独立「我的邀请」**（避免与运营直属陪玩列表混为一谈）。

功能：

1. 专属邀请链接 / 码：生成、复制、撤销  
2. 直属列表：被邀请人昵称、**当前身份**、绑定时间、来源  
3. 有效订单数 / 累计喵币返点  
4. 喵币余额入口（不可提现说明）  
5. **不展示** 现金提现 CTA  

现有 `my-direct-companions`「邀请陪玩加入」可逐步迁到本页或标明「运营邀请（成为你的直属陪玩）」vs「平台邀请（邀请返点）」——实现时文案必须拆开。

---

## 12. 陪玩端「我的邀请」

入口：companion workbench（与「直属负责人」只读卡分开）。

功能：

1. 专属邀请链接（仅审核通过陪玩）  
2. 直属列表（老板/用户/陪玩均可）  
3. 现金返点累计、可结算余额  
4. 结算 / 提现入口（走 referral cash → 提现规则）  
5. **不写入** 喵币账户  

注册时若通过老板码进入：只建立（待确认）邀请关系；**不再**把「直属负责人」与邀请返点混用同一套自动 bind（运营负责人仍可只读展示运营表）。

---

## 13. Admin 直属 / 返点管理

独立模块（勿塞死在仅 boss↔companion 的运营页）：

列表/详情一眼可见：

| 字段 | 说明 |
|------|------|
| 邀请人 | 昵称 / id |
| 邀请人身份 | 绑定快照 `inviter_type_at_binding` |
| 被邀请人 | 昵称 / id |
| 被邀请人当前身份 | live |
| 绑定时间 | `confirmed_at` |
| 来源 | `source` + code |
| 有效订单 | 计数 |
| 返点基数 | 订单级汇总 / 单笔 |
| 返点比例 | 快照 |
| 返点金额 | 汇总 |
| **奖励类型** | **喵币** 或 **现金**（强制展示） |

另需：

- 全局 `boss_referral_rate` / `companion_referral_rate` 编辑  
- 人工 revoke 关系（不改历史 ledger；仅停止未来返点）  
- 按 order 对账 / 重放（幂等）  
- 与运营 `boss_companion_relations` 分 Tab，避免运营 rebind 被误认为改邀请人  

---

## 14. Migration / Rollback Plan

### 14.1 Migration（建议顺序）

1. 建表：`invite_links`（或扩表）、`direct_invite_relations`、`direct_invite_events`、`meow_coin_*`、`referral_cash_*`、settings 键。  
2. 数据迁移：  
   - `boss_invite_links` → `invite_links` (`owner_type=boss`)  
   - **不**自动把 `boss_companion_relations` 全量当成邀请关系（角色不全、且缺用户确认）；可标记 `source=legacy_ops_relation` 的 **可选** 后门仅 admin 确认后导入。  
3. Feature flag：`DIRECT_INVITE_V2=false` 默认；打开后新绑定走确认流。  
4. 订单完成钩子挂返点模块（flag 关闭则 no-op）。  
5. 停用静默 `redeemInviteAfterCompanionReady` 对运营表的自动 bind（或降级为只写 pending 邀请）。  
6. UI：老板/陪玩「我的邀请」+ Admin 模块。  

### 14.2 Rollback

1. Flag 关闭 → 停止新确认绑定与新返点 credit。  
2. 不 drop 表；保留 ledger 便于对账。  
3. 若错误 credit：用 `reversal` 入账，禁止物理删流水。  
4. 邀请解析回退旧 `boss_invite_links` resolve（双读一期）。  
5. **不回滚** Hall / #222 / 其他无关 PR。  

### 14.3 明确不做（本 design PR）

- 不改代码与 schema 落地  
- 不 Merge  
- 不碰 Hall UI、#222、首页热门推荐、Push、Pricing、Order 主流程、Auth  

---

## 15. 开放项（实现前需你点头）

1. **返点基数** `referral_rebate_base`：建议默认 `order_paid_amount`；备选 `platform_fee`。  
2. 现金已提现后的退款：`clawback_debt` vs 限制未来结算。  
3. 喵币与猫粮钱包是否镜像；建议独立喵币，消费路由二期接。  
4. `user` vs `boss` 是否共用 `boss_referral_rate`（本设计：共用喵币档）。  
5. Legacy `boss_companion_relations` 是否提供 admin「导入为邀请关系」工具（默认不做自动导入）。

---

## 16. 验收标准（实现阶段用，非本 PR）

- [ ] 四矩阵奖励类型 100% 由 `inviter_type_at_binding` 决定  
- [ ] 老板邀请任何人都只进喵币且不可提现  
- [ ] 陪玩邀请任何人都只进现金 referral ledger  
- [ ] 被邀请人成陪玩后邀请人不变、奖励类型不变  
- [ ] 无确认不绑定；二次链接不覆盖  
- [ ] 同订单不双返；退款可冲正  
- [ ] Admin 可见奖励类型「喵币|现金」与双 rate  
- [ ] 与 `boss_commission_earnings` 账本分离  

---

## 文档修订记录

| 版本 | 说明 |
|------|------|
| v1（作废） | 误按「被邀请人身份 / 仅陪玩返点」等旧理解 |
| **v2（本文件）** | 按 `inviter_type` 锁死双产物 + 四矩阵 + 双 ledger |
