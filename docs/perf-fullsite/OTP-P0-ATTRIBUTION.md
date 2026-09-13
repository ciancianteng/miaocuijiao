# OTP P0 FAIL — attribution (Performance PR)

## Verdict

**OTP P0 FAIL is NOT introduced by this Performance PR.**

## Evidence

1. **Perf branch delta vs base `faf64fe` (#239 OTP hotfix merge) does not modify OTP/auth delivery:**
   - Phase 1 commit `771ddce` files: companions, daily-stats, orders expire, content-acks, indexes, brand webp, boss cache wiring, vercel allow-list, docs/scripts.
   - No edits to `server/api/auth.js`, `server/api/_mail.js`, `server/api/_otp-store.js` in the Performance commits.

2. **Production probe (2026-09-12, this agent):**
   - `POST /api/auth` body `{ action: "send_login_otp", email: "<unknown>", role: "boss" }` → **HTTP 200** with anti-enumeration success + `retryAfterSec: 60` (matches `server/api/auth.js` action name).
   - Wrong payload shapes (`purpose: login` without action) → 400 "请输入邮箱和密码。" — client contract issue, not perf regression.

3. **OTP delivery reliability was fixed on main via #239** (`925d925` / merge `faf64fe`) before this perf branch was cut. Perf branch is based on that merge.

4. **If a screenshot still shows OTP P0 = FAIL**, treat it as:
   - stale screenshot from before #239, or
   - Production env/DNS/Resend issue tracked in `docs/otp-delivery-p0-hotfix.md` / `docs/otp-delivery-investigation.md`,
   - **not** as a reason to rewrite OTP inside the Performance PR.

## Performance PR policy

Do **not** change OTP/login business logic in this PR unless a regression is proven to be caused by perf commits (cache of `/api/auth`, etc.). Current vercel allow-list does **not** include auth/OTP paths.
