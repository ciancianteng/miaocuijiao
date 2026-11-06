# MCJ-PLACE-ORDER-UI-APPROVED-V1

老板最终确认的「立即下单」UI 基准（2026-11-06）。

## Staging 验收来源

| 项 | 值 |
| --- | --- |
| Staging URL | https://meow-cuijiao-homepage-staging.vercel.app/ |
| Deployment ID | `dpl_Tc4UAZUJugAzCUke8jKP8eVZcHmU` |
| Deploy host | `meow-cuijiao-homepage-hntqpv83f-ciancianteng-4581s-projects.vercel.app` |
| Build ID | `bld_r9gu5j1mp` |
| Commit (deploy-time HEAD) | `e9b23f44d0ffb27a3fe97c97196f81aaa1485106` |
| CSS cache | `20261106poUi8` |
| Supabase | Staging `cfccwysniduwkjskiqgy` |

## 视觉基准截图

- `desktop.png` — 桌面端打开「立即下单」
- `mobile-390.png` — 390px 宽度打开「立即下单」

## 布局契约（必须保持）

1. `.mcj-po-game-list`：`grid-template-columns: repeat(2, minmax(0,1fr))`（含 ≤767px）
2. `.mcj-po-game-option`：`display:flex; flex-direction:row; align-items:center; justify-content:space-between`
3. 名称靠左、价格靠右、同行；价格色 `#ff9fcd`
4. 服务时长步进器靠右；不得改回旧版堆叠卡片文字

## 回归

```bash
npm run verify:place-order-ui-freeze
# 可选线上量测：
BASE_URL=https://www.meowcuijiao.com npm run verify:place-order-ui-freeze:live
```
