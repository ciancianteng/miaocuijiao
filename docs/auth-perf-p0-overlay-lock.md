# Auth / Performance P0 — 全屏登录 overlay 锁死

## ROOT CAUSE

Anti-blank auth gate（`public/portal-early-gate.js` + `src/role-gates.js`）在老板私页导航时过度阻塞：

1. **过期镜像污染 JWT 判定**：`hasValidAccessJwt` 优先读 `mcjAdminExpiresAt` / 过期的 `mcjAuthExpiresAt`，忽略仍有效的 access JWT `exp`。
2. **全屏 `pending_restore` 锁 UI**：overlay 被排除在 early-gate 12s safety 之外，一直盖到 `ensureSession` 完成。
3. **`boss-auth-session.js` 加载瀑布**：私页未同步引入 SoT，ensureSession 晚到。
4. **mine 非关键 API 串行**阻塞首屏。

不是 SW/缓存问题。未采用 timeout 强藏 overlay。

## 指标

### Production BEFORE

| 场景 | overlay | First usable |
|------|---------|--------------|
| valid_jwt_clean / mine | **0 ms** | ~357 ms |
| valid_jwt_stale_auth_expires / mine | **全屏锁 / 导航中断** | n/a（根因） |
| API me | 222–291 ms | |
| API refresh（无效） | 337–620 ms | |

### Local AFTER（本 PR）

| 场景 | page | overlay | auth bootstrap |
|------|------|---------|----------------|
| valid_jwt_clean | /mine.html | **0 ms** | **113 ms** |
| valid_jwt_clean | /orders.html | **0 ms** | **70 ms** |
| valid_jwt_clean | /messages.html | **0 ms** | **67 ms** |
| valid_jwt_stale_auth_expires | /mine.html | **0 ms** | **57 ms** |
| valid_jwt_stale_auth_expires | /orders.html | **0 ms** | **70 ms** |
| valid_jwt_stale_auth_expires | /messages.html | **0 ms** | **61 ms** |
| valid_jwt_stale_admin_expires | /mine.html | **0 ms** | **77 ms** |
| valid_jwt_stale_admin_expires | /orders.html | **0 ms** | **66 ms** |
| valid_jwt_stale_admin_expires | /messages.html | **0 ms** | **70 ms** |
| expired_jwt_with_refresh | /mine.html | **0 ms** | **74 ms** |
| expired_jwt_with_refresh | /orders.html | **0 ms** | **78 ms** |
| expired_jwt_with_refresh | /messages.html | **0 ms** | **68 ms** |

合法 JWT（含 stale auth/admin expires）overlay **0 ms**；expired+refresh 为 soft-restore 且无全屏 overlay。

## iPhone 375/390/393/430

stale-expires 场景截图：`/opt/cursor/artifacts/auth-perf-iphone/mine-stale-expires-*.png` — 全部 `overlay=false`。

## 未做

- 不 Merge #226；不碰 Hall；不开始 P3/P4；本 PR 只开不 Merge
