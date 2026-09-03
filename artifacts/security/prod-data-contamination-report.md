# Production Data Contamination Investigation Report

**Date:** 2026-09-03  
**Status:** Investigation complete — **no production DB deletes / no deploy performed**  
**Branch:** `cursor/prod-smoke-contamination-guard-3e78` (safeguards only)

---

## 1. Root cause

Production smoke data was **intentionally created against live Production** by Cursor agent **`bc-25ea5d07-0b6a-402e-99b2-0f14810f36a7`** (“Initial project assessment”), branch `cursor/prod-promote-cc56689-36a7`, PR **#136**.

After promoting companion referral rebate (`cc56689` / PR #134) to Production, the agent:

1. Added CI workflows that **default `BASE=https://www.meowcuijiao.com`** and seed Production via `service_role` (`.github/workflows/_prod-smoke-companion-referral.mjs`).
2. When CI could not obtain a usable Production `service_role`, ran an **ad-hoc local OTP smoke** (Guerrilla Mail) against Production APIs.
3. That ad-hoc run completed **`SUMMARY PASS 22/22`** at **2026-09-02T18:47:10Z → 18:49:29Z** and **left all created records in Production** (no cleanup).

This is **not** Staging→Production DB bleed. Live hosts are separate:

| Env | App | Supabase project ref |
|-----|-----|----------------------|
| **Production** | `https://www.meowcuijiao.com` (`env=production`, sha `f4146a6` at investigation time) | `jqfaknpmcnqwqvatrwgo` |
| **Staging** | `https://meow-cuijiao-homepage-staging.vercel.app` (`env=preview`, sha `1e49559`) | `cfccwysniduwkjskiqgy` |

### Contributing guard failures

| Gap | Detail |
|-----|--------|
| Empty Staging guard | On `origin/staging`, `scripts/lib/prod-guard.mjs` was **0 bytes** (imports were no-ops). Real guard exists on `main` (PR #102) but was **never merged into staging**. |
| Production smoke designed to hit prod | PR #136 workflow **refuses non-production BASE** (`if (!/meowcuijiao\.com/i.test(BASE)) exit 2`) — inverted safety. |
| Ad-hoc agent script | Successful contamination used an **uncommitted heredoc**, bypassing even the (broken) CI path and any repo guard. |
| No teardown | Smoke created users/orders/withdrawals and did not delete them. |
| Dashboard unfiltered | Admin dashboard aggregates real `profiles`/`orders` with no `is_test_account` / smoke-name filter. |

**Name note:** User-reported `ProdSmokeInvite2` matches **`ProdSmokeInviter2`** in agent output (typo / truncation).

---

## 2. Environment variable check (read-only)

This Cloud Agent VM has **no** `DATABASE_URL` / Supabase secrets loaded (cannot pull Vercel Production env from here).

Public, read-only verification:

| Check | Production | Staging |
|-------|------------|---------|
| `/api/build-info` | `env=production`, ref `main` | `env=preview`, ref `staging` |
| `/api/public/realtime-config` → `url` host | `jqfaknpmcnqwqvatrwgo.supabase.co` | `cfccwysniduwkjskiqgy.supabase.co` |
| `DATABASE_URL` (this agent) | **unavailable** | **unavailable** |

Repo policy already encodes refs in Staging migration workflows:

- Staging ref: `cfccwysniduwkjskiqgy`
- Production ref: `jqfaknpmcnqwqvatrwgo`

**Can smoke/E2E connect to Production?** Yes historically:

- PR #136 production smoke workflow pulls Vercel **Production** env and hits `www.meowcuijiao.com`.
- Many Staging scripts only had hostname string checks; Staging `prod-guard.mjs` was empty.
- Agents can still run ad-hoc Node against Production if secrets/OTP are available — policy + CI forbid list + dual override mitigate this.

---

## 3. Affected records (from agent transcript; do not delete yet)

Source: ad-hoc Production OTP smoke, agent `bc-25ea5d07…`, **2026-09-02 ~18:47–18:49 UTC**, `BASE=https://www.meowcuijiao.com`, build `cc56689`.

### Display names (dashboard-visible)

| Name | Role | Notes |
|------|------|-------|
| **ProdSmokeInviter2** | companion | Successful *2 run |
| **ProdSmokeService2** | companion | Successful *2 run |
| **ProdSmokeBoss2** | boss | Successful *2 run |
| **ProdSmokeCS** | customer service | `cs.smoke.<stamp>@meow.test` |
| **ProdSmokeService** / **ProdSmokeInviter** / **ProdSmokeBoss** | companions/boss | From CI-oriented / earlier seed naming |
| **Smoke2374** | companion nickname | Earlier OTP probe (`nickname: 'Smoke'+stamp`), **not** the PASS 22/22 *2 run |

### Key IDs (successful *2 run)

| Entity | ID |
|--------|-----|
| Inviter user | `6d368f4b-7f33-4923-9441-c63cecef2070` |
| Service user | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` |
| Boss user | `0664ef55-de58-48e3-8dbb-ca8111318e91` |
| Referral relation | `84172b1d-7ba5-48d0-9abc-ee6b928e70da` |
| Order | `8821329f-32c3-48c3-a24f-dde2b3e4d332` (RM6000 → rebate RM60) |
| Withdrawal | `21e042c8-461e-4e82-a491-b5a390b96674` |
| Smoke2374 profile (earlier) | profile `d42a7555-8265-4941-9e66-8f1bc86f784e`, user `ed5054bd-93d2-434a-b468-68f75423d830` |

### APIs used to create them

`/api/auth` (OTP register/login), `/api/companion`, `/api/companion/boss-invitations`, `/api/boss/companion-invitations`, `/api/orders`, `/api/customer-service`, `/api/admin/players`, `/api/admin/orders`, `/api/admin/finance`, `/api/admin/service-accounts`, `/api/admin/companion-referral`.

### Related commits / PR

| Item | Role |
|------|------|
| PR **#136** `cursor/prod-promote-cc56689-36a7` | Promote + **Production smoke CI** (OPEN / draft lineage) |
| Commit `fd0452a` | `ci: production smoke for companion referral rebate` |
| Commits `3b2d1c9`…`a5ef420` | Harden Production smoke env resolution |
| PR **#102** (merged to `main` only) | Prod Supabase write guard — **missing on staging** |
| Agent URL | https://cursor.com/agents/bc-25ea5d07-0b6a-402e-99b2-0f14810f36a7 |

Parallel read-only agent `bc-d2e75ce5…` (“Production dashboard fake data”) independently confirmed dashboard numbers are **real Production rows**, not mock UI data.

---

## 4. Is production data cleanup needed?

**Yes — after explicit approval.** Smoke companions/bosses/CS, order `8821329f-…` / related finance rows, withdrawal `21e042c8-…`, and `Smoke2374` probe account pollute admin dashboard (companions, CS count, revenue).

**Do not delete yet** (per request). Recommended cleanup plan (approval-gated):

1. Backup affected rows (profiles, companion_profiles, orders, referral_*, withdrawals, service accounts).
2. Whitelist-delete only smoke-tagged identities (`ProdSmoke*`, `Smoke2374`, `*@guerrillamailblock.com`, `cs.smoke.*@meow.test`, `*@mcj-prod-smoke.invalid`).
3. Re-check `/api/admin/dashboard` counts.
4. Rotate/disable shared test admin credentials used against Production (`admin@meow.test` / known test password) if still valid on prod.

---

## 5. Proposed fix (this PR — safeguards only, **no deploy**)

1. **Restore + harden** `scripts/lib/prod-guard.mjs` on Staging (was empty):
   - Deny Production Supabase ref + Production app hosts.
   - `assertSmokeTargetAllowed()` for smoke/E2E (Staging/Preview/local only).
   - Dual-flag override required for any Production write.
2. Wire guard into high-risk scripts:
   - `e2e-companion-referral-rebate-staging.mjs`
   - `e2e-boss-commission-rm30-staging.mjs`
   - `smoke-boss-companion-relations-live.mjs`
   - `p0-companion-smoke.mjs`
3. Add offline verifier `scripts/smoke-prod-guard.mjs`.
4. Add CI workflow `.github/workflows/forbid-production-smoke.yml` to **fail if PR #136-style production smoke files are reintroduced**.
5. **Ops follow-ups (not in this PR):**
   - Close / strip smoke from PR **#136**; do not merge Production smoke workflows.
   - Merge real `prod-guard` into all long-lived branches.
   - Approval-gated Production cleanup of listed IDs.
   - Optionally filter dashboard by `is_test_account` / smoke patterns.
   - Agent policy: never run write smokes against `meowcuijiao.com`.

---

## 6. Verdict

| Question | Answer |
|----------|--------|
| Wrong Production `DATABASE_URL` accidentally used by Staging? | **No** — projects are separate now |
| Did a smoke/agent write Production data? | **Yes** — deliberate Production OTP smoke 2026-09-02 |
| Missing staging guard? | **Yes** — Staging `prod-guard.mjs` was empty; Production smoke workflows exist on promote branch |
| Cleanup needed? | **Yes**, after approval |
| Deploy now? | **No** — awaiting approval |
