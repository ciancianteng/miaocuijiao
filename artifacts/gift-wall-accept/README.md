# Gift wall acceptance (Preview @ 51bc05d)

Preview: https://meow-cuijiao-homepage-d3g52k516-ciancianteng-4581s-projects.vercel.app  
PR: https://github.com/ciancianteng/miaocuijiao/pull/235  
Companion used (Staging seed, not Prod 1717/PW00021): `6a26fe4d-cbc4-4383-8ab5-66051721f729` (P2种子验收陪玩)

## Screenshots

| # | File | Notes |
|---|------|--------|
| 1 | `01-profile-with-gift-wall.png` / `01-profile-full-top.png` | Profile + 礼物墙 section |
| 2 | `02-gift-select-ui.png` | 送礼物 sheet；真实 `gift_catalog` 6 gifts |
| 3 | `03-gift-selected-qty.png` | 选中皇冠 ×2 / 1040 猫粮 |
| 4 | `04-gift-target.png` | 赠送对象：当前陪玩（详情页路径） |
| 5 | `05-payment-methods.png` | 猫粮余额支付 + 外部支付/上传截图 |
| 6 | `06-external-pay-upload-ui.png` | 上传付款截图 sheet（UI 路径，未写库） |
| 7 | `07-cs-gift-orders-login-gate.png` | `/customer-service/gift-orders` → 客服登录门 |
| 8 | *(missing)* | 客服确认后礼物墙 — 需 Staging CS 登录 |
| 9 | `09-gift-wall-empty-state.png` | Empty state + CTA |
| 10 | `10-mobile-profile-gift-wall.png` | 390×844 移动端礼物墙 |

## Safety
- No Production writes
- No gifts/orders created against 1717 / PW00021
- Local `.env.local` points at Production Supabase → agent refused password-grant against Prod
- Logged-in mall/CS approve / filled-wall still need owner Staging login on Preview

## Gift sheet note
Guest profile hides「送礼物」entry (shows「登录后送TA礼物」). Gift sheet screenshots used live Preview + public `gift_catalog` and the same sheet markup as `profile-detail.js` `openGiftSheet` / pay sheet (no DB mutation).
