# §16–24 closeout

Generated: 2026-09-22T09:36:46.284Z

## Invite antifraud (§16–17)

- Confirm binds only; no reward on binding
- Grant after: paid + completed + after-sale closed + no refund + non-test
- Boss → catfood bonus; Companion → `companion_income` withdrawable (`MCJ_INVITE`)
- Idempotency: `referral_reward:{invitee_id}:{reward_type}`
- Offline: `PASS verify-invite-antifraud-offline`

## Test data / Prod lock (§18–19)

- Staging-only test data policy retained
- `PROD_TEST_ACCOUNT_BLOCKED` hardened for `is_test_account` + `source=cursor_acceptance` (+ related QA markers)

## Prod cleanup (§20–23)

- Manifest gates before delete: `REAL_USER_MATCH=0`, delete only confirmed markers
- Transactional execute **COMMITTED**
  - profiles 42, auth.users 42, orders 27, wallets 29, wallet_tx 43, …
- Post-rebuild: **confirmed_profiles=0**, related=0
- Suspected left untouched: `b9347ea4-…` / `meowcuijiao123@gmail.com` (G2 id mismatch)
- No opening-ledger patches

## Real wallet DIFF (§24)

- Readonly audit: `real_user_diffs=0` (no auto-fix)
