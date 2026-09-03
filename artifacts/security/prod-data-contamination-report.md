# P0 Incident Report — Production Smoke / E2E Data Injection

**Date:** 2026-09-03  
**Severity:** P0  
**Status:** Investigation complete — safeguards implemented — **no Production DB deletes**

---

## 1. Root cause

Automated testing wrote real records into **Production**.

### Culprit path

Cursor agent **`bc-25ea5d07-0b6a-402e-99b2-0f14810f36a7`** (“Initial project assessment”), branch `cursor/prod-promote-cc56689-36a7`, **PR #136**.

After promoting companion referral rebate (`cc56689` / PR #134) to Production, that agent:

1. Added CI workflows that **default `BASE=https://www.meowcuijiao.com`** and seed Production via `service_role`:
   - `.github/workflows/production-smoke-companion-referral.yml`
   - `.github/workflows/_prod-smoke-companion-referral.mjs` (commit lineage including `fd0452a`)
2. When CI lacked a usable Production `service_role`, ran an **ad-hoc local OTP smoke** (Guerrilla Mail) against Production APIs.
3. That ad-hoc run completed **`SUMMARY PASS 22/22`** at **2026-09-02T18:47:10Z → 18:49:29Z** and **left all created records in Production** (no teardown).

This is **not** Staging→Production DB bleed. Live hosts are separate:

| Env | App | Supabase project ref |
|-----|-----|----------------------|
| **Production** | `https://www.meowcuijiao.com` | `jqfaknpmcnqwqvatrwgo` |
| **Staging** | `https://meow-cuijiao-homepage-staging.vercel.app` | `cfccwysniduwkjskiqgy` |

### Why Production was allowed

| Gap | Detail |
|-----|--------|
| Inverted smoke safety | PR #136 workflow **refuses non-production BASE** — designed to hit Production. |
| Empty Staging guard | On `origin/staging`, `scripts/lib/prod-guard.mjs` was **0 bytes** (imports were no-ops). Real guard lived on `main` (PR #102) but was never merged to staging. |
| Ad-hoc agent heredoc | Successful contamination used an **uncommitted** `node <<'NODE'` OTP smoke, bypassing CI and repo guards. |
| No teardown | Smoke created users/orders/withdrawals and did not delete them. |
| No runtime API block | Production APIs accepted `@meow.test` / `ProdSmoke*` identities and order writes. |

### Script / commit that introduced the behavior

| Item | Role |
|------|------|
| PR **#136** `cursor/prod-promote-cc56689-36a7` | Promote + Production smoke CI |
| Commit `fd0452a` (+ follow-ups) | `ci: production smoke for companion referral rebate` |
| Ad-hoc OTP heredoc (2026-09-02 ~18:47 UTC) | **Actual successful write** that left `ProdSmoke*2` records |
| Agent | https://cursor.com/agents/bc-25ea5d07-0b6a-402e-99b2-0f14810f36a7 |

---

## 2. Affected records

**Do not delete yet** (per incident instructions).

### User-reported Production order management

| Orders | Test identities |
|--------|-----------------|
| `MCJO000344` | `ProdSmokeBoss2` |
| `MCJO000343` | `ProdSmokeService2` |
| `MCJO000342` | `ProdSmokeCS` |

Public order numbers use the `MCJO######` allocator (`server/api/_account-codes.js`). These human-visible codes correspond to smoke-created Production orders tied to the identities below.

### Agent-confirmed identities / IDs (OTP *2 PASS run)

| Name | Role | Notes |
|------|------|-------|
| **ProdSmokeInviter2** | companion | Successful *2 run (dashboard may show truncated “Invite2”) |
| **ProdSmokeService2** | companion | Successful *2 run |
| **ProdSmokeBoss2** | boss | Successful *2 run |
| **ProdSmokeCS** | customer service | `cs.smoke.<stamp>@meow.test` |
| **ProdSmokeService** / **ProdSmokeInviter** / **ProdSmokeBoss** | companions/boss | CI-oriented / earlier seed naming |
| **Smoke2374** | companion nickname | Earlier OTP probe |

| Entity | ID |
|--------|-----|
| Inviter user | `6d368f4b-7f33-4923-9441-c63cecef2070` |
| Service user | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` |
| Boss user | `0664ef55-de58-48e3-8dbb-ca8111318e91` |
| Referral relation | `84172b1d-7ba5-48d0-9abc-ee6b928e70da` |
| Order UUID | `8821329f-32c3-48c3-a24f-dde2b3e4d332` (RM6000 → rebate RM60) |
| Withdrawal | `21e042c8-461e-4e82-a491-b5a390b96674` |

### APIs used

`/api/auth` (OTP register/login), `/api/companion`, invitation APIs, `/api/orders`, `/api/customer-service`, `/api/admin/*`.

---

## 3. Prevention fix (this PR)

Safeguards only — **no business logic / order calculation changes**, **no Production deletes**.

1. **Hardened** `scripts/lib/prod-guard.mjs`
   - Deny Production Supabase ref + Production app hosts.
   - `assertSmokeTargetAllowed()` for smoke/E2E (Staging/Preview/local only).
   - Dual-flag override required for any Production write.
2. **Runtime Production API guard** `server/api/_test-accounts.js`
   - Block smoke/test identity register + login on Production.
   - Block automated test order creation (`/api/orders`, marketplace `create_and_pay`) when caller is a test/smoke account.
3. Wire guard into high-risk scripts: companion smoke, preview smokes, four-end E2E, order-notify E2E.
4. Offline verifier `scripts/smoke-prod-guard.mjs`.
5. CI workflow `.github/workflows/forbid-production-smoke.yml` fails if PR #136-style production smoke files are reintroduced.
6. Cursor rule `.cursor/rules/no-production-smoke.mdc` — always-apply ban on Production write smokes.

### Manual approval for Production writes

Requires **both** env flags:

- `ALLOW_PROD_SUPABASE_WRITE=1` + `CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK`  
  or  
- `ALLOW_PROD_MUTATION=1` + `CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK`

### Follow-ups (not in this PR)

- Close / strip smoke from open **PR #136**; do not merge Production smoke workflows.
- Merge prod-guard into all long-lived branches (especially Staging).
- Approval-gated Production cleanup of listed IDs / `MCJO000342–344`.
- Rotate/disable shared test admin credentials if still valid on Production.

---

## 4. Verdict

| Question | Answer |
|----------|--------|
| Which script created these records? | Ad-hoc Production OTP smoke from agent `bc-25ea5d07…` (PR #136 lineage); CI script `_prod-smoke-companion-referral.mjs` designed the same path |
| Which commit introduced the behavior? | `fd0452a` (+ PR #136 promote/smoke workflows); contamination executed 2026-09-02 ~18:47 UTC |
| Why was Production allowed? | Inverted CI safety + empty Staging prod-guard + unguarded ad-hoc heredoc + no API-level smoke block |
| Cleanup now? | **No** — awaiting explicit approval |
| Deploy now? | Awaiting review of this safeguard PR |
