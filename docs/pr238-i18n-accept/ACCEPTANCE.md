# PR #238 i18n acceptance (do not merge)

## Verdict
**FAIL** — not safe to merge.

## What works now
- Catalog parity: zh-CN / en = **478** keys (`npm run verify:locale-parity` PASS)
- Runtime: `MCJI18n`, storage `mcj_locale`, event `mcj:localechange`
- Bottom nav / header language switch: live update without full page rewrite of URL
- Locale persistence: reload keeps `en` (`screenshot-session.json` persistence block)
- Hall status filter uses stable codes (`online|busy|paused|offline`) + translated labels
- Banner/announcement EN field passthrough (API + admin crop_meta.i18n + client pick)
- Home popularity / daily stats / site cards / forgot-password partially wired
- Support consult chrome / status strings partially wired

## Blocking gaps (hardcoded ZH audit)
Approximate remaining ZH string literals (see `hardcoded-strings-audit.md`):
- `src/companion-workbench.js` ~829
- `src/companion-application.js` ~398
- `src/support-chat.js` ~152
- `orders.html` ~151
- `src/profile-detail.js` ~106
- Apply steps 1–4 body / validation still largely ZH
- Workbench page bodies still largely ZH
- Many secondary pages (recharge/gifts/etc.) incomplete

## Companion list 0 / load fail
**Not an i18n bug.** Publish gate in `server/api/public/companions.js` (approved + active + allow orders + not test). See `companion-list-root-cause.md`.

## Screenshots
Under `docs/pr238-i18n-accept/screenshots/` and `/opt/cursor/artifacts/pr238-i18n/{zh,en}/`.
