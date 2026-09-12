# Banner / Announcement localization evidence

## Banner (client)
`src/home-banner.js` picks EN fields when locale is `en`:
`title_en`, `subtitle_en`, `button_text_en` / `cta_en`, `image_url_en` / `image_en`, `mobile_image_url_en`.
Re-renders on `mcj:localechange`.

## Banner (API)
`server/api/platform/content.js` `bannerItem()` exposes EN fields from:
- row `*_en` columns (if present), and/or
- `crop_meta.i18n` object

## Banner (admin)
`src/admin-banner-manager.js` EN inputs saved into `crop_meta.i18n` on create/update without breaking crop zoom/x/y.

## Announcements (client)
`src/home-announcements.js` uses `title_en` / `content_en` / `body_en` / `text_en` and re-applies on locale change.
Platform default soft-launch row includes ZH+EN copy for empty-CMS fallback.

## Announcements (API)
`announcementItem()` exposes `title_en` / `content_en` (and aliases) from columns or trailing `[mcj-i18n]{...}[/mcj-i18n]` marker (stripped from ZH body).

## Gap remaining for PASS
CMS rows in production may still lack EN assets until operators fill EN fields in admin. Client/API plumbing is in place.
