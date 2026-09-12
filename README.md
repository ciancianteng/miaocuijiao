# MEOW CUI JIAO Local Site

This repository is the local development base for the preserved MEOW CUI JIAO preview site.

## Deploy / Staging

公开预览（Staging）= **Vercel Preview**；正式站 = **Vercel Production**。

| Doc | Purpose |
| --- | --- |
| [`STAGING_SETUP.md`](./STAGING_SETUP.md) | Preview 测库 + HitPay Sandbox |
| [`PRODUCTION_SETUP.md`](./PRODUCTION_SETUP.md) | 正式库 + HitPay Live |
| [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) | 四端验收与发版清单 |
| [`README_DEPLOY.md`](./README_DEPLOY.md) | 本地 / Phase 1 部署细节 |

Env templates: `.env.example`（本地）、`.env.preview.example`、`.env.production.example`.

## Local Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The site is a Vite multi-page app. The HTML pages live in the project root, shared scripts and styles live in `src/`, and media files live in `assets/`.
