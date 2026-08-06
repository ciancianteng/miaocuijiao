# AGENTS.md

## Cursor Cloud specific instructions

### What this project is
`meow-cuijiao-homepage` is a Vite multi-page app (静态 HTML + `src/` scripts) for a gaming companion (陪玩) platform with four "ends":

| 端 | Entry route | Notes |
| --- | --- | --- |
| 老板端 (boss) | `/` (`index.html`), `/login`, `/orders`, `/place-order`, `/recharge`, `/mine` | Design **frozen** — see `.cursor/rules/boss-design-freeze.mdc` |
| 陪玩端 (companion) | `/companion/`, `/companion/login`, `/companion/dashboard` | |
| 客服端 (customer service) | `/customer-service/`, `/customer-service/login`, `/customer-service/dashboard` | |
| 后台中心 (admin) | `/admin/`, `/admin/login` | UI/layout **frozen** — see `.cursor/rules/admin-design-freeze.mdc` |

There is **one process**: `npm run dev` (Vite, http://localhost:5173). A Vite plugin in `vite.config.js` serves the serverless API from `server/api/**` at `/api/*` (same code Vercel runs). There are **no** `lint` or `test` npm scripts. Build with `npm run build`. Standard commands live in `package.json` and `README.md` / `README_DEPLOY.md`.

### The app is fail-closed without Supabase (important)
Core APIs (`/api/auth`, `/api/orders`, chat, companion, CS, most admin) return **HTTP 503** and refuse reads/writes unless Supabase env vars are present. There is **no** offline/fake-data fallback for auth or orders (`server/api/_mvp-store.js` is dead code). Verify readiness with:

```bash
curl 'http://localhost:5173/api/auth?action=health'   # expect {"configured":true,"missing":[]}
```

If it returns `configured:false`, the local Supabase stack and/or `.env.local` are not up (see below).

### Local backend = a local Supabase stack (Docker + Supabase CLI)
This repo talks to hosted Supabase in production, but for local dev a **full local Supabase stack** is used (it provides `auth.users`/GoTrue, PostgREST, Storage, Realtime that the schema and `/api/auth` admin calls depend on). Docker, the Supabase CLI, the pulled images, the applied schema (in Docker volumes), and `.env.local` are all persisted in the VM snapshot, so normally you only need to **start** them:

1. Start the Docker daemon if it is not already running (it does not auto-start):
   ```bash
   pgrep dockerd >/dev/null || sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
   ```
   `/etc/docker/daemon.json` is preconfigured for this VM: `storage-driver: fuse-overlayfs` and `features.containerd-snapshotter: false` (required for Docker 29 + fuse-overlayfs); `iptables` is set to legacy. Don't change these.
2. Start Supabase from the repo root (config at `supabase/config.toml`, gitignored/local-only):
   ```bash
   supabase start          # prints API URL + anon/service_role keys; API at http://127.0.0.1:54321
   ```
3. Ensure `.env.local` (gitignored) exists and points `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at the values from `supabase status -o env`. Also set `MCJ_ALLOW_TEST_PAY=1` so orders can be paid without a real HitPay gateway. Restart `npm run dev` after creating/changing `.env.local` (Vite reads env at startup, not via hot reload).

### Non-obvious gotchas
- **GRANTs after loading schema**: the schema was applied by running `supabase/*.sql` then `supabase/migrations/*.sql` through `psql` as the `postgres` superuser (into container `supabase_db_workspace`). Doing so does **not** auto-grant the Supabase API roles, so PostgREST/`service_role` calls fail with `permission denied for table ...`. After any full re-seed you must re-run:
  ```sql
  grant usage on schema public to anon, authenticated, service_role;
  grant all privileges on all tables in schema public to anon, authenticated, service_role;
  grant all privileges on all sequences in schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  ```
- A handful of legacy SQL files log benign ordering errors when applied in bulk (e.g. `order_grabs` syntax superseded by `..._order_grabs_fix.sql`, optional indexes on differently-named tables). They do not affect the boss/order/auth flow.
- HitPay/SMTP/AI/SMS keys are optional; leave unset for local dev.

### Test accounts
Accounts are created in Supabase Auth, not seeded offline. During setup a boss `boss.hello@meow.test` / `McjTest@12345678` was created, or just register a fresh boss from `/` (register form on the homepage). Documented team test logins are in `README_DEPLOY.md` §6.

### Acceptance rules (from `.cursor/rules`)
Formal四端 acceptance/screenshots use the **fixed Staging URL** `https://meow-cuijiao-homepage-staging.vercel.app/`, deployed via `node scripts/deploy-staging.mjs` on the `staging` branch. Do not overwrite the production domain `meowcuijiao.com`. Local `http://localhost:5173` is for development, not formal acceptance.
