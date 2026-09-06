# G9 — 正式上线验收 Checklist（准备稿）

**状态：CHECKLIST READY — 验收动作需在 G0–G8 落地后由人工签字**  
**禁止：** 本阶段不开启 `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED`；不 DELETE smoke；不 DROP。

---

## 0. 前置门禁

- [ ] G0：01–05 已 apply 且对象存在
- [ ] G1：`is_test_account` 列存在，默认 false
- [ ] G2：11 账号已标记；companion 镜像一致
- [ ] G3：真实非 test admin 可登录
- [ ] G4–G6：代码已部署（Dashboard 过滤 + commission/points fail-closed）
- [ ] G7：确认无历史 `platform_fee` 自动回补 SQL 曾执行
- [ ] G8：Production env 未设置或显式 `false`（结算/积分关闭）

---

## 1. GMV 对账

**目标：** 正式 GMV **不含** smoke（尤其 MCJO000344 / RM6000）。

| # | 检查 | 期望 | 签字 |
|---|---|---|---|
| 1.1 | Dashboard `stats.totalAmount` | 不含 6000 smoke | ☐ |
| 1.2 | Dashboard `filter.excludedOrders` | ≥ smoke 触达订单数 | ☐ |
| 1.3 | 只读：正式订单集（非 test 触达）金额合计 | 与 Dashboard 一致 | ☐ |
| 1.4 | 正式候选订单（非 smoke 双方） | 仍在正式视图（若已付款/应计） | ☐ |

建议只读 SQL（表齐全后）：

```sql
select coalesce(sum(o.total_amount),0) as business_gmv
from orders o
where o.status in ('pending','waiting_boss_confirm','claimed','confirmed','in_progress','completed','refund_requested')
  and not exists (
    select 1 from profiles p
    where p.id in (o.boss_id, o.companion_id, o.customer_service_id)
      and p.is_test_account = true
  );
```

---

## 2. Earnings 对账

**目标：** test 用户订单 **不产生** `boss_commission_earnings`。

| # | 检查 | 期望 | 签字 |
|---|---|---|---|
| 2.1 | test boss 的 earnings 行数 | 0 | ☐ |
| 2.2 | smoke 完成单 order_id 对应 earnings | 0 | ☐ |
| 2.3 | flag 关闭时任意新完成单 | skipped，无新 earnings | ☐ |

```sql
select count(*) as test_earnings
from boss_commission_earnings e
join profiles p on p.id = e.boss_id
where p.is_test_account = true;
```

---

## 3. Points 对账

**目标：** test 用户 **不产生** 正式积分 ledger（award/clawback）。

| # | 检查 | 期望 | 签字 |
|---|---|---|---|
| 3.1 | test user ledger 行数 | 0（或仅跳过标记且无正分） | ☐ |
| 3.2 | smoke 订单 idempotency `order_points:*` | 无正分入账 | ☐ |
| 3.3 | `POINTS_AWARD_ENABLED` unset/false | 写入路径 skipped | ☐ |

```sql
select count(*) as test_ledger
from user_points_ledger l
join profiles p on p.id = l.user_id
where p.is_test_account = true;
```

---

## 4. Smoke 数据隔离验证

| # | 检查 | 期望 | 签字 |
|---|---|---|---|
| 4.1 | `profiles` marked test = 11 | 是 | ☐ |
| 4.2 | 正式候选仍 `is_test_account=false` | 是 | ☐ |
| 4.3 | Dashboard bosses/companions/CS 计数排除 smoke | 是 | ☐ |
| 4.4 | Production 登录 `admin@meow.test` | 403 拦截 | ☐ |
| 4.5 | 真实 admin 登录后台 | 成功 | ☐ |
| 4.6 | Smoke 订单/账号 **未被 DELETE** | 行仍在 | ☐ |
| 4.7 | 大厅不展示 test companion（若门禁启用） | 是 | ☐ |

---

## 5. 开启结算前最终签字

| 角色 | 姓名 | 日期 | 同意开启 SETTLEMENT/POINTS |
|---|---|---|---|
| 工程 | | | ☐ |
| 运营 | | | ☐ |
| 产品 | | | ☐ |

**规则：** 三方签字前 **禁止** 设置 `SETTLEMENT_ENABLED=true` 或 `POINTS_AWARD_ENABLED=true`。  
历史回补另开变更单，不与首开绑定。
