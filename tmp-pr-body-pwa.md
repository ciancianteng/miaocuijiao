## Summary
- Site-wide boss-frontend PWA “Add to Home Screen” glass bottom sheet (iOS teach / Android install)
- Web app manifest, icons (192/512/180), minimal service worker, and PWA meta tags
- Mine page entry: 「添加妙脆角到主屏幕」 → `MCJPwaInstall.open({force:true})`
- Auto-prompt rules: standalone/installed skip, dismiss cooldown 7d, max 3 autos, delayed show

## Test plan
- [ ] Home / hall / profile: iOS UA shows Safari share teaching sheet after delay
- [ ] Android Chrome: install button when `beforeinstallprompt` available; teach fallback otherwise
- [ ] Dismiss → reload within 7d → no auto prompt; `mcj_pwa_installed=1` → never auto-show
- [ ] Mine logged-in entry opens force tutorial
- [ ] `/manifest.webmanifest` and `/sw-mcj.js` reachable; icons load
- [ ] Admin / companion / CS portals not injected (boss-header `isBossPublicPage`)
