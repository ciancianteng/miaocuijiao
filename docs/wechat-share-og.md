# WeChat / WeCom share card (Open Graph)

## What this PR does

Adds production-ready Open Graph + Twitter Card metadata to the homepage, plus dedicated public share images (not homepage screenshots).

Stable public URLs (no Vite hash):

- `https://www.meowcuijiao.com/og/share-card-square.jpg` (600×600, preferred for WeChat chat cards)
- `https://www.meowcuijiao.com/og/share-card.jpg` (1200×630, OG / Twitter)

Canonical site URL: `https://www.meowcuijiao.com/` (apex `meowcuijiao.com` 308 → www).

## Regenerate images

```bash
node scripts/generate-og-share-card.cjs
```

## Important: WeChat / WeCom limitations

Website OG tags cover **URL paste / link preview crawl** in many cases.

Custom in-page share buttons (`wx.updateAppMessageShareData`, WeCom JS-SDK) require **manual platform config** (AppID, JS security domain, signature backend). This PR does **not** claim those are done.
