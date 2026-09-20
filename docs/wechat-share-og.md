# WeChat / WeCom share card (Open Graph)

## What this PR does

Adds production-ready Open Graph + Twitter Card metadata to the homepage, plus dedicated public share images (not homepage screenshots).

Stable public URLs (no Vite hash):

- `https://www.meowcuijiao.com/og/share-card-square.jpg` (600×600, preferred for WeChat chat cards)
- `https://www.meowcuijiao.com/og/share-card.jpg` (1200×630, OG / Twitter)

Canonical site URL: `https://www.meowcuijiao.com/` (apex `meowcuijiao.com` 308 → www).

## Final metadata (homepage)

| Field | Value |
| --- | --- |
| `<title>` | 妙脆角 MEOW CUI JIAO｜专业游戏陪玩 |
| `meta description` | 专业陪玩，每一场游戏认真对待每一位热爱电竞的你。 |
| `canonical` | `https://www.meowcuijiao.com/` |
| `og:type` | `website` |
| `og:url` | `https://www.meowcuijiao.com/` |
| `og:title` | 妙脆角 MEOW CUI JIAO｜专业游戏陪玩 |
| `og:description` | 专业陪玩，每一场游戏认真对待每一位热爱电竞的你。 |
| `og:image` (1st) | `https://www.meowcuijiao.com/og/share-card-square.jpg` |
| `og:image` (2nd) | `https://www.meowcuijiao.com/og/share-card.jpg` |
| `twitter:card` | `summary_large_image` |
| `twitter:image` | `https://www.meowcuijiao.com/og/share-card.jpg` |

## Regenerate images

```bash
node scripts/generate-og-share-card.cjs
```

## A–E: What code can vs cannot finish

### A. Currently achievable with website code alone

- Page title / description / canonical
- Full Open Graph + Twitter Card tags
- Dedicated public share JPEG under `/og/` (HTTPS absolute URL, no login, no hash)
- Cache / CORS headers for `/og/*` so crawlers can fetch images
- Helps **paste-link / URL preview** cards in WeChat / WeCom / iMessage / Slack / Discord in many cases

### B. Needs WeChat 公众平台 / 企业微信 admin (manual)

- If you need **in-page custom share** (tap 分享给朋友 / 分享到朋友圈 and force title/desc/image via JS): WeChat JS-SDK + signature backend
- Domain ownership / ICP filing consistency checks on the platform side
- Optional: 公众号「网页授权域名」、业务域名校验文件
- WeCom: 应用可信域名 / JS-SDK 可信域名（仅自定义分享时）
- Clearing old WeChat link-preview cache (微信公众平台 → 网页调试 / 清缓存工具；或换带 query 的 URL 测一次)

### C. Materials you may need to provide

| Need | When |
| --- | --- |
| 已认证服务号 / 订阅号（或企业微信管理后台权限） | 自定义 JS 分享 |
| 域名 `meowcuijiao.com` / `www.meowcuijiao.com` 备案与主体一致材料 | 平台审核 / 域名绑定 |
| 服务器可访问的校验文件或 DNS TXT（按后台指引） | 域名验证 |
| HTTPS 正式站已上线且 OG 已部署 | 分享预览验收 |

**Not needed for this PR’s paste-link OG path:** AppSecret in frontend, user login for the image URL.

### D. Is 公众号 AppID / JS-SDK required?

| Goal | AppID / JS-SDK |
| --- | --- |
| Chat 里粘贴 `https://meowcuijiao.com` 出品牌卡片 | **通常不需要**（靠爬虫读 OG） |
| 站内按钮调用 `wx.updateAppMessageShareData` 等强制自定义 | **需要** AppID + JS-SDK + 后端签名 |

This PR only covers the first row.

### E. Does meowcuijiao.com need「JS 接口安全域名」?

- **Paste-link OG preview:** No.
- **WeChat JS-SDK custom share:** Yes — add `www.meowcuijiao.com`（以及如需 apex）to 公众号「JS 接口安全域名」, and implement `/api/...` signature with AppID + AppSecret（Secret 只能放服务端）。

## Important limitations (do not over-claim)

1. WeChat / WeCom **do not guarantee** perfect OG rendering; crawlers may cache aggressively or pick another large image on the page.
2. Square `og:image` is listed first because WeChat chat cards often look better with ~1:1 thumbs.
3. This PR does **not** install WeChat JS-SDK or signature APIs.
4. Production image URLs return **404 until this branch is merged and Production redeployed**.
