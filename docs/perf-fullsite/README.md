# Full-site performance optimization

Independent Performance track (not mixed with PWA / i18n / OTP / UI acceptance PRs).

- Phase 1 profile + quick wins: [`PHASE1-PROFILE.md`](./PHASE1-PROFILE.md)
- Production BEFORE baseline: [`baseline-prod-before.json`](./baseline-prod-before.json)
- Phase 1 BEFORE/AFTER ledger: [`before-after-phase1.json`](./before-after-phase1.json)

Re-measure:

```bash
node scripts/perf-fullsite-baseline.mjs https://www.meowcuijiao.com
node scripts/perf-fullsite-baseline.mjs https://<preview-host>
```


## Phase 2–5 (this PR continuation)

- Status: [`PHASE2-5-STATUS.md`](./PHASE2-5-STATUS.md)
- Cache policy: [`CACHE-POLICY.md`](./CACHE-POLICY.md)
- OTP P0 attribution: [`OTP-P0-ATTRIBUTION.md`](./OTP-P0-ATTRIBUTION.md)
- Measured Phase1 Preview: [`measured-phase1-preview.json`](./measured-phase1-preview.json)

**Merge = BLOCKED** until Preview redeploy AFTER numbers + OTP smoke PASS.
