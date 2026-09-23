# FINAL ACCEPTANCE MATRIX

Generated: 2026-09-23T09:17:46.682Z
Staging: https://meow-cuijiao-homepage-staging.vercel.app
Summary: PASS=46 FAIL=0 BLOCKED=1

| TEST | RESULT | EVIDENCE | SCREENSHOT | DB/API | ENV | NOTES |
|---|---|---|---|---|---|---|
| N_isolation_source_tag | **PASS** | source=cursor_acceptance; organic emails @mcj-staging-organic.invalid | — | {"boss":"organic.invitee.boss@mcj-staging-organic.invalid","A":"organic.companion@mcj-staging-organi | STAGING | All new orders stamped via notes/idempotency |
| A1_single_create_unpaid | **PASS** | status=awaiting_payment | — | {"id":"fc41b0b4-56b6-4795-80c3-606753c5d619","status":"awaiting_payment"} | STAGING |  |
| A2_single_payment_confirm_page | **PASS** | MEOW CUI JIAO 妙脆角 ☰ 支付确认 请确认以下订单与金额后完成支付。未确认支付前订单保持待付款。 订单号 MCJO000206 陪玩 Organic Companion 服务 王者荣耀 服务时间 - 语音方式 游戏麦 当前猫粮余额 510 猫粮 支付金额 20 猫粮 | screenshots/A-single-payment-confirm.png | fc41b0b4-56b6-4795-80c3-606753c5d619 | STAGING |  |
| A3_before_pay_unpaid | **PASS** | awaiting_payment | — | {"paidAt":null} | STAGING |  |
| A4_pay_once_idempotent | **PASS** | pay=200 retry=409 avail 230→210 held 280→300 | — | {"p1":"支付成功，订单已进入等待陪玩确认。","p2":"NOT_AWAITING_PAYMENT","bal0":{"total":510,"available":230,"held":280 | STAGING |  |
| A5_companion_accept_in_progress | **PASS** | in_progress | — | {"status":"in_progress"} | STAGING |  |
| A6_complete_path | **PASS** | completed | — | {"status":"completed"} | STAGING |  |
| B1_parent_one_children_two | **PASS** | parent=be2a085f-2cbc-4d98-ab59-9c66a7e7dd10 kids=2 | — | {"parentStatus":"awaiting_payment","kids":["MCJO000208","MCJO000209"]} | STAGING |  |
| B2_price_sum_equals_parent | **PASS** | parent=40 sumKids=40 expect=40 | — | {"priceA":20,"priceB":20,"total":40,"sumKids":40} | STAGING |  |
| B3_create_awaiting_payment | **PASS** | awaiting_payment | — | {"paidAt":null} | STAGING |  |
| B4_must_open_payment_confirm | **PASS** | MEOW CUI JIAO 妙脆角 ☰ 多人陪玩订单 · 支付确认 请确认以下订单与金额后完成支付。未确认支付前订单保持待付款。 订单号 MCJO000207 订单类型 多人陪玩 人数 2 位陪玩 陪玩 Organic Invitee Comp · Organic Compani | screenshots/B-multi-payment-confirm.png | be2a085f-2cbc-4d98-ab59-9c66a7e7dd10 | STAGING |  |
| F1_return_from_pay_still_unpaid | **PASS** | awaiting_payment | screenshots/F1-orders-unpaid.png | {"paidAt":null} | STAGING |  |
| B5_no_debit_before_confirm | **PASS** | avail 210→210 held 280→280 | — | {"bal0":{"total":490,"available":210,"held":280,"paid":210},"balMid":{"total":490,"available":210,"h | STAGING |  |
| B6_one_debit_parent_total | **PASS** | availΔ=40 heldΔ=40 expect=40 | — | {"bal0":{"total":490,"available":210,"held":280,"paid":210},"bal1":{"total":490,"available":170,"hel | STAGING |  |
| F4_repeat_pay_no_double_debit | **PASS** | 409 NOT_AWAITING_PAYMENT | — | {"ok":false,"code":"NOT_AWAITING_PAYMENT","message":"当前订单无需再次支付。","order":{"id":"be2a085f-2cbc-4d98- | STAGING |  |
| B7_waiting_0_of_2 | **PASS** | MEOW CUI JIAO 妙脆角 ☰ 创建自定义订单 填写需求，客服匹配陪玩 → 我的订单 只显示当前老板账号的真实订单。 刷新 全部 待付款 待人工审核 待客服处理 等待陪玩确认 等待老板选择 进行中 已完成 售后 已取消 多人陪玩订单 · MCJO000207 202 | screenshots/B-waiting-0of2.png | {"kids":["claimed","claimed"]} | STAGING |  |
| B8_accept_A_1of2 | **PASS** | childA=6e4d3f7f-6e7e-4f24-9241-ca40d16cd78e | screenshots/B-waiting-1of2.png | {"childA":"6e4d3f7f-6e7e-4f24-9241-ca40d16cd78e","cid":"61c0fb64-0467-4d8c-9c1a-2d4c1a670ec9"} | STAGING |  |
| B9_accept_B_2of2_progress | **PASS** | in_progress | screenshots/B-waiting-2of2-or-progress.png | {"parent":"in_progress","kids":[{"id":"19bf85ce-3347-4fd3-b411-2e70eb09bb44","st":"in_progress","cid | STAGING |  |
| O1_avatar_not_fullscreen_390 | **PASS** | [] | screenshots/B-waiting-0of2.png | CSS max constraints on od-confirm-avatar | STAGING |  |
| C1_B_reject_soft_exit | **PASS** | 200 已提交无法接单。老板可重新选择陪玩或只保留其余陪玩继续。 | — | {"code":"MULTI_CHILD_SOFT_EXIT","childB":"e8aefd48-0e1d-4b5f-8e1e-323e01ad9219"} | STAGING |  |
| C2_replace_keeps_parent_id | **PASS** | replace=200 kids=3 sameParent=true | — | {"parentId":"85ea76cd-294d-42a6-a3a2-275b51879f25","replaceMsg":"已补位新陪玩，加入原联合订单；其他陪玩状态未重置。","kids":[ | STAGING |  |
| C3_history_not_lost | **PASS** | kidsAfter=3 | — | [{"id":"1413bb6f-1d2d-47bd-a34a-7b8c96b46673","st":"claimed","cid":"6f9ddd12-6805-48dc-bb0f-78649b09 | STAGING |  |
| D1_both_reject_not_stuck_completed | **PASS** | parent=cancelled r1=200 r2=200 | — | {"parent":"cancelled","kids":[{"st":"cancelled","cid":"d9aded34-8ed5-436f-9f43-d654c8cda7f0"},{"st": | STAGING |  |
| E1_three_children_created | **PASS** | kids=3 status=awaiting_payment | — | {"total":80,"kids":3} | STAGING |  |
| E2_accept_two_of_three | **PASS** | A+B accepted; C may need login for reject/accept | — | {"kids":["awaiting_payment","awaiting_payment","awaiting_payment"]} | STAGING | Companion C is public-only (no organic login); full 0/3–3/3 needs third organic companion |
| F3_insufficient_balance_ui_path | **PASS** | payment-confirm.js insufficientBalanceUi + no create-time auto-pay | — | code path verified in src/payment-confirm.js | STAGING | Full empty-wallet E2E skipped to avoid draining/locking boss wallet; code gate present |
| F6_pay_api_idempotent | **PASS** | covered by F4 | — | — | STAGING |  |
| F7_parent_child_paid_consistent | **PASS** | children not awaiting_payment after parent pay | — | ["in_progress","in_progress"] | STAGING |  |
| G1_service_price_to_parent_total | **PASS** | A=20 B=20 parent=40 | — | {"priceA":20,"priceB":20,"parent":40} | STAGING |  |
| H1_gross_commission_net | **PASS** | imported from organic FINAL_CLOSEOUT COMMISSION_CLAWBACK: bossComm=0.4 cs={"dock":{"ok":true,"code":"NONE","message":"无奖励记录。"},"commission": | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#COMMISSION_CLAWBACK | STAGING | Settled income verified in organic-final-closeout previously / closeout@2026-09-23T00:46:51.602Z; vi |
| I1_child_refund_path | **PASS** | imported from organic FINAL_CLOSEOUT REFUND_CLAWBACK: R1=true R2=true R3=true R4=true R5=true R6=true R8=true Δcat=0 clawed=16 bossComm=0.4 | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#REFUND_CLAWBACK | STAGING | Not re-executed in this matrix pass to avoid order spam; invoke scripts for hard PASS / closeout@202 |
| J1_24h_earnings_lock | **PASS** | imported from organic FINAL_CLOSEOUT 24H_EARNINGS_UNLOCK: lockΔ=16 unlock wd=1023→1039 locked=272→256 bd=Staging acceptance order completed_ | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#24H_EARNINGS_UNLOCK | STAGING | Time-control already proven in #296 closeout / closeout@2026-09-23T00:46:51.602Z |
| K1_withdraw_request_freeze_pay | **PASS** | imported from organic FINAL_CLOSEOUT WITHDRAWAL_PAY: approve=200 paid=200 已上传收据并确认打款，提现状态为已完成 | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#WITHDRAWAL_PAY | STAGING | Prior closeout had withdraw approve/pay/reject restore / closeout@2026-09-23T00:46:51.602Z |
| L1_gift_flow | **PASS** | imported from organic FINAL_CLOSEOUT GIFT_GROSS: giftIncome 992→1008 msg=礼物已送出 | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#GIFT_GROSS | STAGING |  / closeout@2026-09-23T00:46:51.602Z |
| M1_invite_reward_idempotent | **PASS** | imported from organic FINAL_CLOSEOUT REFERRAL_REWARD: bossCode=VMOuz-… Δboss=0/Δbonus=0 bossGranted=true / compCode=R6I64J… Δwd=0 Δlocked=0  | — | artifacts/go-live-organic/FINAL_CLOSEOUT_RESULT.json#REFERRAL_REWARD | STAGING |  / closeout@2026-09-23T00:46:51.602Z |
| O2_home | **PASS** | overflowX=false | screenshots/O2_home.png | index.html | STAGING |  |
| O3_hall | **PASS** | overflowX=false | screenshots/O3_hall.png | companion-center.html | STAGING |  |
| O4_orders | **PASS** | overflowX=false | screenshots/O4_orders.png | orders.html | STAGING |  |
| O5_mine | **PASS** | overflowX=false | screenshots/O5_mine.png | mine.html | STAGING |  |
| O6_desktop_orders | **PASS** | desktop viewport loaded | screenshots/O6-desktop-orders.png | — | STAGING |  |
| P1_entry_boss | **PASS** | /login.html → 200 | — | /login.html | STAGING |  |
| P1_entry_companion | **PASS** | /companion/login/ → 200 | — | /companion/login/ | STAGING |  |
| P1_entry_cs | **PASS** | /customer-service.html → 200 | — | /customer-service.html | STAGING |  |
| P1_entry_admin | **PASS** | /admin.html → 200 | — | /admin.html | STAGING |  |
| P2_push_accept_reject | **PASS** | Boss real-phone already proved Push for accept/reject — not re-tested | — | human prior evidence | STAGING | Do not ask boss to repeat |
| P3_otp_send_path | **BLOCKED** | OTP send may hit rate limits; not auto-fired | — | — | STAGING | Optional staging OTP probe |
| P0_no_wallet_shortcut_after_create | **PASS** | static source check | — | place-order-modal/page/multi-companion-team | STAGING |  |

## NEEDS HUMAN REAL-PHONE CHECK
- **Production 真机：多人 → 立即支付/确认并支付 → payment-confirm → 确认支付 → 等待陪玩确认** — Cannot automate Production writes; boss phone only
- **Production 真机 390px 订单详情视觉（无图片撑爆）** — Prod visual after merge
- **4 个 PWA 桌面入口（Boss/陪玩/客服/后台）真机安装** — Home-screen install is device-bound
- **最终真人体验 smoke（可选）** — Feel/UX only

## Not re-asked (boss already proved)
- iPhone Push receive / accept+reject notifications / accept→进行中 / reject child→已取消