# 老板端 UI / 业务修复审计（P1–P5）

> Status: **audit-only**（本 PR 先给方案与现状截图，**不实现落地、不 Merge**）  
> 隔离：不碰 Hall UI / #222 / 无关后端大改  
> 分支：`cursor/boss-mine-gift-msg-fix-6f29`

---

## 总览

| ID | 问题 | 根因一句话 | Migration？ |
|----|------|------------|-------------|
| P1 | 单/信/客/充圆形单字 | `mine.html` 故意用单字当 icon | 否 |
| P2 | 老板端泄漏公式 | UI + API 同时下发 `boss_commission = platform_fee…` | 否 |
| P3 | 邀请/直属「尚未开通」 | feature flag + 表未就绪；且旧系统≠新 inviter_type 设计 | 接新系统时可能要（见 #224 design） |
| P4 | 点「赠送」→ Gift sent | `gifts.html` 本地 toast 假成功；真路径是钱包秒扣，无审核 | **是**（新建 gift order + proof 流） |
| P5 | 暂无会话下黑紫大块 | 双空态卡片同时渲染 + `min-height:620px` + `messages.css` 404 | 否 |

---

## 1. 根因

### P1 — 快捷入口
- 文件：`mine.html`（约 L211–219 CSS，L441–445 HTML 拼接）
- `.mine-quick-ico` 内写死「单 / 信 / 客 / 充」，下方另有「订单 / 消息 / 客服 / 充值」label
- 点击本身正常：`orders.html` / `messages.html` / `support.html?start=1` / `recharge.html`
- **不是** 文案截断 bug，是占位 icon 设计

### P2 — 公式泄漏
- 前端：`src/my-direct-companions.js` `renderCommissionCard()`
  - 写死中文：`平台抽成金额 × 分成比例%`
  - 写死/回显 code：`boss_commission = platform_fee × rate / 100`
- 后端：`server/api/boss/commission-earnings.js` `summary.formula` 主动返回同一字符串
- 老板可见「数据库字段名 + 内部算法」——违规

### P3 — 邀请占位
- UI：`src/my-direct-companions.js` `renderInvitePanel()` 在 `inviteMeta.disabled` 时显示「邀请链接功能尚未开通」
- API：`server/api/_boss-invite-links.js` → `BOSS_INVITE_LINKS_DISABLED`（`BOSS_INVITE_LINKS_ENABLED` fail-closed）
- 直属列表：`tablesReady:false` →「直属关系尚未开通」
- SQL 草案：`supabase/pending-prod/09_boss_invite_links.sql`（未作为本任务落地）
- **更关键：** 现网 boss invite 只服务 **运营直属陪玩**（`boss_companion_relations`），与 design #224 的 **通用直属邀请（inviter_type → 喵币/现金）** 不是同一套。  
  → **禁止**在本页再造第二套关系表；UI 应对齐 #224 接口位 / 文案，后端实现跟 #224。

### P4 — 礼物假成功
两条并行路径：

| 路径 | 行为 | 问题 |
|------|------|------|
| `gifts.html` + `src/platform.js` `[data-gift]` | `toast("Gift sent: …")` | **纯前端假成功**；无收礼人、无支付、无凭证、无审核 |
| `companion-detail` → `POST /api/boss/marketplace` `send_gift` | 钱包猫粮即时扣款 + 写 `gift_transactions` | 有收礼人，但是 **秒到账**；无付款截图、无客服审核 |

- Schema 现状：`gifts` + `gift_transactions`（`supabase/companion-marketplace.sql`）——**无** `pending_review` / `payment_proof` / `gift_orders`
- Admin：`admin-gifts` 只管目录 CRUD，**不管**送礼审核

### P5 — 消息黑紫块
复合根因：
1. `src/customer-service-customer-chat.js` `paint()` **总是**同时渲染：
   - list 空态「暂无会话」
   - main 空态「请选择会话」
2. `src/chat-ui.css`：`.mcj-customer-chat-list/main { min-height: 620px }` → 手机上两块巨型深色卡片
3. `messages.html` 引用 `/src/messages.css` → **HTTP 404**（样式未挂上 / 部分回退到全局暗紫底）
4. loading 与 empty 互斥不彻底时，大块卡片仍保留

→ 用户截图「暂无会话下面还有黑紫矩形」= 第二块 detail 空态卡片（+ 可能未加载的 CSS）

---

## 2. 现有可复用模块

| 能力 | 复用点 |
|------|--------|
| 老板邀请码生成/解析 | `server/api/_boss-invite-links.js`、`invite.html`（**模式**复用；产品语义跟 #224 对齐） |
| 运营直属关系 | `boss_companion_relations` + `_boss-companion-relations.js`（**勿当**邀请返点 SoT） |
| 邀请返点设计 | PR #224 `docs/design-direct-invite-referral-v2.md`（inviter_type 矩阵） |
| 支付方式 / QR | `payment_methods`、`server/api/topup.js`、`_platform-pay-qr.js`、`admin/payment-settings.js` |
| 付款截图上传 + 审核 | `src/payment-confirm.js`、`src/mcj-upload.js`、`server/api/_payment-receipts.js`、finance admin review |
| 钱包扣款（可选备用） | marketplace `send_gift` + `debitWallet`（**本需求改走法币/线下支付审核，不默认秒扣猫粮**） |
| 聊天/通知 | `src/chat-api.js`、`server/api/chat.js`、notify toast |
| Admin 审核 UI 模式 | 充值凭证审核页（状态机：pending → approved/rejected） |

---

## 3. 修改方案（建议实现顺序）

### P1（小改，纯前端）
- 删除 `.mine-quick-ico` 单字节点
- 四个入口改为等高文字按钮：订单 / 消息 / 客服 / 充值
- 保留原 `href`；统一 padding / min-height；四列 grid 不变

### P2（前端 + API 收敛）
- `my-direct-companions.js`：删除 formula 区块与一切 `platform_fee` / `boss_commission` 文案
- `commission-earnings.js`：`summary` **不再返回** `formula` 字段（或仅 admin 接口保留）
- 老板可见字段改为：等级、权益、喵币返点比例（接新系统后）、累计喵币、直属人数、有效直属、下一等级进度、贡献记录  
  - 过渡期：若仍展示旧「运营分成金额」，只显示金额/笔数，**不显示公式**；文案与 #224「喵币返点」对齐时再替换数据源

### P3（接新系统，不另起炉灶）
- UI 改为「我的专属邀请」结构：链接 / 复制 / 分享 / 二维码位 / 人数 / 累计喵币 / 明细
- 数据契约对齐 #224：`invite_links` + `direct_invite_relations` + confirm-bind  
- 若后端未 merge：显示「即将开通」+ disabled 控件，**不要**再写一套 localStorage 关系
- 明确文案：老板邀请 → 喵币不可提现（不说现金）

### P4（新订单流 + migration）
状态机：

```text
select_recipient → select_gift → pay_modal → upload_proof
  → pending_review → (admin) approved/delivered | rejected
```

- **禁止** `toast('Gift sent')` 假成功
- 新建 `gift_orders`（建议）字段：  
  `id, order_no, boss_id, recipient_companion_id, gift_id, amount, currency, payment_method, payment_proof_url, status, reviewed_by, reviewed_at, delivered_at, created_at…`  
  status ∈ `pending_payment | pending_review | approved | delivered | rejected | cancelled`
- Admin 审核通过后才：写展示用 gift 记录 / 通知陪玩 / 老板端「已送达」
- 复用：payment methods config、upload、admin review 队列模式
- `gifts.html` 重做：顶部固定「送给：头像/昵称/PW」；无 recipient 则强制选择器；按钮「立即送礼」

### P5（纯前端互斥）
- `messages.html`：改为引入真实存在的 `src/chat-ui.css`（或补 `messages.css` re-export）
- `customer-service-customer-chat.js`：状态互斥  
  - loading → 只 skeleton  
  - loaded+empty → **只**一个空态（暂无会话 + 引导点客服）  
  - loaded+list → list；选中后才显示 main  
- 移动端 empty：**隐藏** detail 卡片；去掉 620px 双卡
- 降低 empty 卡片 min-height / 去厚重紫底块

---

## 4. 影响文件（预计）

**P1**  
- `mine.html`

**P2**  
- `src/my-direct-companions.js`  
- `my-direct-companions.html`（若有内联样式）  
- `server/api/boss/commission-earnings.js`（去掉对外 formula）

**P3**  
- `src/my-direct-companions.js`  
- 只读依赖 #224 design；**不**新建第二套 relation 实现  
- 可选：轻量 API facade 指向未来 `direct_invite_*`

**P4**  
- `gifts.html`、`src/platform.js`（删除假 toast）  
- 新：`src/gifts.js`（或同等）  
- `server/api/boss/marketplace.js`（送礼改为建单，不瞬时 delivered）  
- 新：`server/api/admin/gift-orders.js`（审核）  
- Admin 前端礼物审核页  
- **Migration：** `gift_orders` + proof 字段  
- 通知：chat / notify 钩子

**P5**  
- `messages.html`  
- `src/customer-service-customer-chat.js`  
- `src/chat-ui.css`（empty/mobile 规则）  
- 可选新建 `src/messages.css` 作为入口

**明确不改**  
- Hall / companion-center 照片布局（#222）  
- Pricing / Auth / 主订单核心（除非礼物单独立表）

---

## 5. UI 截图（现状 / Before）

手机宽度 390 / 393 / 430 均已采集，目录：  
`docs/boss-mine-gift-msg-audit/shots/`

| 场景 | 文件 |
|------|------|
| P1 单字入口 | `audit-p1-390.png` 等 |
| P2/P3 公式+占位 | `audit-p2p3-390.png` 等 |
| P4 礼物商城无收礼人 | `audit-gifts-390.png` 等 |
| P5 双空态大块 | `audit-p5-390.png` 等 |

说明：真实 `mine.html` / `messages.html` 未登录会被登录墙挡住；P1/P2/P5 用与线上一致的 DOM/CSS **fixture** 复现问题像素（单字 ico、formula code、双卡 620px）。P4 为真实 `gifts.html` 页面截图。

---

## 6. 数据流

### 直属邀请（目标，对齐 #224）

```text
Boss/Companion 生成 invite_link
  → 用户打开链接注册
  → 展示邀请人资料
  → 用户点「确认绑定」
  → direct_invite_relations(active) 冻结 inviter_type_at_binding
  → 有效完成订单
  → if inviter boss/user → meow_coin_ledger
     if inviter companion → referral_cash_ledger
```

老板端「直属分成中心」只读上述 **喵币** 汇总；**不**展示 platform_fee 公式。

### 礼物（目标）

```text
选收礼陪玩 → 选礼物 → 立即送礼
  → 创建 gift_orders(pending_payment/pending_review)
  → 展示收款信息（payment_methods）
  → 上传 payment_proof
  → status=pending_review
  → Admin 通过 → delivered + 通知陪玩 + 老板「已送达」
  → Admin 拒绝 → rejected + 老板可重传/联系客服
```

**绝不**在点击瞬间写「已送出」给陪玩。

### 消息空态

```text
loadConversations
  loading? → skeleton only
  !loading && length==0 → single empty state (no detail card)
  length>0 → list; detail only if selected
```

---

## 7. 是否需要 migration

| 项 | 需要？ | 说明 |
|----|--------|------|
| P1 | 否 | 纯 UI |
| P2 | 否 | 去掉字段/文案即可 |
| P3 | 视 #224 | 本页不单独 migration；跟新直属系统一起 |
| P4 | **是** | 建议 `gift_orders` + proof/review 字段；现有 `gift_transactions` 可保留为「已送达后的不可变流水」或后期迁 |
| P5 | 否 | CSS/渲染互斥 |

---

## 8. 验收对照（实现阶段）

- P1：无「单/信/客/充」；四文字入口等高  
- P2：无 `platform_fee` / `boss_commission` / 公式  
- P3：结构接新邀请系统；无第二套关系；无「假开通」本地绑定  
- P4：有收礼人、支付弹窗、截图、pending_review；Admin 通过后才送达  
- P5：空态仅「暂无会话」文案区，无黑紫双大块  

实现后补 390/393/430 after 截图；**先不 Merge。**

---

## 9. 建议下一跳（等你点头）

1. 先落 P1 + P2 + P5（低风险、无 migration）  
2. P3 UI 壳对齐 #224（禁用态接口位）  
3. P4 schema + 订单流 + Admin 审核（单独可测）
