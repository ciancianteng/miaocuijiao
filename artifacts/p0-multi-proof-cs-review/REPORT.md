# Multi proof → CS review E2E

Generated: 2026-09-23T20:57:34.363Z  
Staging: https://meow-cuijiao-homepage-staging.vercel.app  
Order under test: **MCJO000242**  
Summary: **PASS=7 FAIL=0**

## Status machine (API authoritative)

| Step | order.status | paymentReview / paymentStatus | companionConfirm | API |
|---|---|---|---|---|
| ① create multi | `awaiting_payment` | false / 待付款 | kids=`awaiting_payment` | place_multi_order OK |
| ③ pay_order blocked | `awaiting_payment` | false | kids=`awaiting_payment` | `400 MANUAL_PAYMENT_REQUIRES_PROOF` |
| ⑤⑥ submit proof | `awaiting_payment` | **true / 待客服审核** | kids=`awaiting_payment` (not pending) | submit_payment_proof `paymentReview:true` |
| ⑦ companion accept before CS | unchanged | — | — | accept_direct_order **409** `当前订单不能确认接单` |
| ⑧⑨ CS confirm_payment | **`claimed`** | false / 已付款 | kids=`claimed` + confirm=`pending` | confirm_payment `path: multi_confirm` |
| ⑩ mid 1/2 | `claimed` | 已付款 | 1×`in_progress` + 1×`claimed` | accept 200 |
| ⑩ fin 2/2 | `in_progress` | 已付款 | 2×`in_progress` | accept 200 |

## Checklist screenshots

| # | Result | Evidence | Screenshot |
|---|---|---|---|
| ① create | PASS | parent=awaiting_payment kids=2 | — |
| ④ payment+proof UI | PASS | payOrderBtns=0 proofBtns=2 | `screenshots/04-payment-info-and-proof-upload.png` |
| ③ pay_order blocked | PASS | MANUAL_PAYMENT_REQUIRES_PROOF | — |
| ⑤⑥ Boss=待客服审核 | PASS | order=MCJO000242 apiReview=true | `screenshots/06-boss-pending-cs-review.png` |
| ⑦ companion blocked | PASS | accept=409 claimable=false | `screenshots/07-companion-cannot-confirm-before-cs.png` |
| ⑧⑨ Boss=等待陪玩确认(0/2) | PASS | parent=claimed kids=claimed,claimed | `screenshots/09-boss-waiting-0of2-after-cs.png` |
| ⑩ 0→1→2 | PASS | mid=claimed,in_progress fin=in_progress,in_progress | `screenshots/10a-boss-waiting-1of2.png`, `10b-boss-after-2of2.png` |

Full raw API payloads: `EVIDENCE.json`
