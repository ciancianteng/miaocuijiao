# Phase A Audit — Meow Cui Jiao Mobile App Prototype

Date: 2026-09-10
Base: `origin/main` @ `d7e6afa`
New branch: `ui/mobile-app-prototype` (independent of PR #213)

## Current main homepage structure

Order today:
1. Sticky `mcj-boss-header` (desktop nav + mobile hamburger)
2. CMS Banner (`data-mcj-home-hero`) — top of page, card-framed
3. Announcement strip
4. Daily stats (`data-home-daily-stats`) — three boxed cards
5. Quick entry / apply / popularity / companion tracks
6. `mobile-bottom-nav`: 首页 / 陪玩 / 语音 / 玩法 / 我的

## Reusable (keep)

- Banner CMS API + `home-banner.js` crop/carousel
- Daily stats API `/api/gateway?path=home/daily-stats` fields: `onlineCompanions`, `ordersCreated`, `grossRevenue`
- Public companions `/api/public/companions`
- Popularity API `/api/popularity?action=home` + server `_popularity.js` scoring
- Boss header auth/login/mine/support wiring (`boss-header.js`)
- Auth early-gate fix from PR #212 (merged)

## PR relationship

| PR | Role | Homepage UI? | Action |
|----|------|--------------|--------|
| #198 | commission/gameplay | No | Do not touch |
| #199 | daily stats (historical) | Data path | Reuse API only |
| #205 | companion pricing | No | Do not touch |
| #212 | auth early-gate | Auth | Already on main |
| #213 | immersive banner/hero experiments | Yes | Leave alone; new PR instead |

## Conflicts / risks

- `index.html` inline CSS + `home-banner.css` + `home-desktop.css` + `home-mobile.css` fight over banner size/radius
- `body` `pageIn` animation leaves `transform`, breaking `position:fixed` tabbar (must clear on app shell)
- Desktop layout must stay website-like; mobile needs separate APP CSS, not shrunk desktop

## Tags pipeline

- Admin/DB: `companions.tags` (string)
- Public API maps `tags: stripGamePricesMarker(String(row.tags || ""))` then split expected by frontend
- Frontend `site-data.js`: `tagsHtml(item.tags || item.serviceTags)`
- Risk: if tags stay as raw string with game-price markers stripped empty, UI shows blank — fix mapping only, no hardcode

## Popularity ranking (real rules)

Server `_popularity.js` `scoreFromBucket`:
- + completed orders points
- + five-star reviews
- + gift cat food
- − reject penalty
Rank by `popularity_score` then orders.

Frontend issue: `fillTopThree()` pads board with random public companions at `popularityScore:0` when API returns <3 — invents podium ranks. Prototype will stop inventing ranks.

## Guest browse

Public home/banner/companions/hall should not require login. Login required for orders/mine/wallet/workbench. Bottom nav: 订单/我的 may prompt login via existing mine/orders pages — not force on home browse.
