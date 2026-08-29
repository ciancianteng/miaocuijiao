# API Catch-all Mapping (pre-delete)

Generated: 2026-07-29T12:20:00.472Z

Vercel entry (kept): `api/[...path].js` → handlers in `server/api/`.

Public URL paths stay unchanged (e.g. `/api/auth`). The catch-all resolves them to `server/api/*.js`.

| Old Function file | Public path (unchanged) | catch-all resolves to | Mapped |
| --- | --- | --- | --- |
| `api/admin/banners.js` | `/api/admin/banners` | `server/api/admin/banners.js` | yes |
| `api/admin/bosses.js` | `/api/admin/bosses` | `server/api/admin/bosses.js` | yes |
| `api/admin/companion-levels.js` | `/api/admin/companion-levels` | `server/api/admin/companion-levels.js` | yes |
| `api/admin/companion-tags.js` | `/api/admin/companion-tags` | `server/api/admin/companion-tags.js` | yes |
| `api/admin/content.js` | `/api/admin/content` | `server/api/admin/content.js` | yes |
| `api/admin/dashboard.js` | `/api/admin/dashboard` | `server/api/admin/dashboard.js` | yes |
| `api/admin/finance.js` | `/api/admin/finance` | `server/api/admin/finance.js` | yes |
| `api/admin/gameplay-products.js` | `/api/admin/gameplay-products` | `server/api/admin/gameplay-products.js` | yes |
| `api/admin/gifts.js` | `/api/admin/gifts` | `server/api/admin/gifts.js` | yes |
| `api/admin/messages.js` | `/api/admin/messages` | `server/api/admin/messages.js` | yes |
| `api/admin/orders.js` | `/api/admin/orders` | `server/api/admin/orders.js` | yes |
| `api/admin/payment-settings.js` | `/api/admin/payment-settings` | `server/api/admin/payment-settings.js` | yes |
| `api/admin/platform-content.js` | `/api/admin/platform-content` | `server/api/admin/platform-content.js` | yes |
| `api/admin/platform-content-upload.js` | `/api/admin/platform-content-upload` | `server/api/admin/platform-content-upload.js` | yes |
| `api/admin/platform-settings.js` | `/api/admin/platform-settings` | `server/api/admin/platform-settings.js` | yes |
| `api/admin/players.js` | `/api/admin/players` | `server/api/admin/players.js` | yes |
| `api/admin/popularity.js` | `/api/admin/popularity` | `server/api/admin/popularity.js` | yes |
| `api/admin/recharge-campaigns.js` | `/api/admin/recharge-campaigns` | `server/api/admin/recharge-campaigns.js` | yes |
| `api/admin/service-accounts.js` | `/api/admin/service-accounts` | `server/api/admin/service-accounts.js` | yes |
| `api/admin/service-packages.js` | `/api/admin/service-packages` | `server/api/admin/service-packages.js` | yes |
| `api/admin/service-records.js` | `/api/admin/service-records` | `server/api/admin/service-records.js` | yes |
| `api/admin/services.js` | `/api/admin/services` | `server/api/admin/services.js` | yes |
| `api/admin/wallet.js` | `/api/admin/wallet` | `server/api/admin/wallet.js` | yes |
| `api/admin/points.js` | `/api/admin/points` | `server/api/admin/points.js` | yes |
| `api/auth.js` | `/api/auth` | `server/api/auth.js` | yes |
| `api/boss/marketplace.js` | `/api/boss/marketplace` | `server/api/boss/marketplace.js` | yes |
| `api/chat.js` | `/api/chat` | `server/api/chat.js` | yes |
| `api/companion.js` | `/api/companion` | `server/api/companion.js` | yes |
| `api/coupons.js` | `/api/coupons` | `server/api/coupons.js` | yes |
| `api/customer-service.js` | `/api/customer-service` | `server/api/customer-service.js` | yes |
| `api/gateway.js` | `/api/gateway` | `server/api/gateway.js` | yes |
| `api/home/daily-stats.js` | `/api/home/daily-stats` | `server/api/home/daily-stats.js` | yes |
| `api/notifications.js` | `/api/notifications` | `server/api/notifications.js` | yes |
| `api/orders.js` | `/api/orders` | `server/api/orders.js` | yes |
| `api/payment-callback.js` | `/api/payment-callback` | `server/api/payment-callback.js` | yes |
| `api/platform/companion-levels.js` | `/api/platform/companion-levels` | `server/api/platform/companion-levels.js` | yes |
| `api/platform/content.js` | `/api/platform/content` | `server/api/platform/content.js` | yes |
| `api/platform/content-asset.js` | `/api/platform/content-asset` | `server/api/platform/content-asset.js` | yes |
| `api/platform/gameplay-products.js` | `/api/platform/gameplay-products` | `server/api/platform/gameplay-products.js` | yes |
| `api/platform/services.js` | `/api/platform/services` | `server/api/platform/services.js` | yes |
| `api/platform/settings.js` | `/api/platform/settings` | `server/api/platform/settings.js` | yes |
| `api/popularity.js` | `/api/popularity` | `server/api/popularity.js` | yes |
| `api/public/companions.js` | `/api/public/companions` | `server/api/public/companions.js` | yes |
| `api/recharge.js` | `/api/recharge` | `server/api/recharge.js` | yes |
| `api/points.js` | `/api/points` | `server/api/points.js` | yes |
| `api/reports.js` | `/api/reports` | `server/api/reports.js` | yes |
| `api/service-packages.js` | `/api/service-packages` | `server/api/service-packages.js` | yes |

## Summary
- Old Function entry files scanned: 45
- Mapped (safe to delete after catch-all ready): 45
- Unmapped (must keep): 0
- Remaining Functions after delete: **1** (`api/[...path].js`); `api/_*.js` helpers are private and not counted
- `api/gateway.js` → copy to `server/api/gateway.js`, then delete old entry

## Safe-to-delete list
- `api/admin/banners.js` → `server/api/admin/banners.js`
- `api/admin/bosses.js` → `server/api/admin/bosses.js`
- `api/admin/companion-levels.js` → `server/api/admin/companion-levels.js`
- `api/admin/companion-tags.js` → `server/api/admin/companion-tags.js`
- `api/admin/content.js` → `server/api/admin/content.js`
- `api/admin/dashboard.js` → `server/api/admin/dashboard.js`
- `api/admin/finance.js` → `server/api/admin/finance.js`
- `api/admin/gameplay-products.js` → `server/api/admin/gameplay-products.js`
- `api/admin/gifts.js` → `server/api/admin/gifts.js`
- `api/admin/messages.js` → `server/api/admin/messages.js`
- `api/admin/orders.js` → `server/api/admin/orders.js`
- `api/admin/payment-settings.js` → `server/api/admin/payment-settings.js`
- `api/admin/platform-content.js` → `server/api/admin/platform-content.js`
- `api/admin/platform-content-upload.js` → `server/api/admin/platform-content-upload.js`
- `api/admin/platform-settings.js` → `server/api/admin/platform-settings.js`
- `api/admin/players.js` → `server/api/admin/players.js`
- `api/admin/popularity.js` → `server/api/admin/popularity.js`
- `api/admin/recharge-campaigns.js` → `server/api/admin/recharge-campaigns.js`
- `api/admin/service-accounts.js` → `server/api/admin/service-accounts.js`
- `api/admin/service-packages.js` → `server/api/admin/service-packages.js`
- `api/admin/service-records.js` → `server/api/admin/service-records.js`
- `api/admin/services.js` → `server/api/admin/services.js`
- `api/admin/wallet.js` → `server/api/admin/wallet.js`
- `api/auth.js` → `server/api/auth.js`
- `api/boss/marketplace.js` → `server/api/boss/marketplace.js`
- `api/chat.js` → `server/api/chat.js`
- `api/companion.js` → `server/api/companion.js`
- `api/coupons.js` → `server/api/coupons.js`
- `api/customer-service.js` → `server/api/customer-service.js`
- `api/gateway.js` → `server/api/gateway.js`
- `api/home/daily-stats.js` → `server/api/home/daily-stats.js`
- `api/notifications.js` → `server/api/notifications.js`
- `api/orders.js` → `server/api/orders.js`
- `api/payment-callback.js` → `server/api/payment-callback.js`
- `api/platform/companion-levels.js` → `server/api/platform/companion-levels.js`
- `api/platform/content.js` → `server/api/platform/content.js`
- `api/platform/content-asset.js` → `server/api/platform/content-asset.js`
- `api/platform/gameplay-products.js` → `server/api/platform/gameplay-products.js`
- `api/platform/services.js` → `server/api/platform/services.js`
- `api/platform/settings.js` → `server/api/platform/settings.js`
- `api/popularity.js` → `server/api/popularity.js`
- `api/public/companions.js` → `server/api/public/companions.js`
- `api/recharge.js` → `server/api/recharge.js`
- `api/points.js` → `server/api/points.js`
- `api/admin/points.js` → `server/api/admin/points.js`
- `api/reports.js` → `server/api/reports.js`
- `api/service-packages.js` → `server/api/service-packages.js`