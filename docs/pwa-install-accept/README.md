# PWA install + official cat app icons — acceptance

## Why Production shows letter "M" TODAY
Production `/icons/*` and `/manifest.webmanifest` still **404** until this PR merges. Browsers fall back to a monochrome letter glyph from the site name. **Not a design choice.**

After merge: delete the old home-screen icon and re-add 妙脆角 to pick up the official cat logo.

## Icon set (official source: `/og/meowcuijiao-logo-transparent.png`)
- any: `/icons/icon-192.png`, `/icons/icon-512.png` (brand purple-black gradient, ~11% pad)
- maskable: `/icons/icon-*-maskable.png` (~20% safe zone)
- iOS: `/apple-touch-icon.png` + `/icons/apple-touch-icon.png` (180)
- favicon: `/favicon-32.png`, `/favicon.ico`

## Evidence
- icon-previews/* (including maskable circle overlay)
- ios-home-teach.png / android-install-ui.png (install sheet with cat logo)
- verify.json (this run checklist)

Regenerate icons: `node scripts/build-pwa-icons.cjs`
