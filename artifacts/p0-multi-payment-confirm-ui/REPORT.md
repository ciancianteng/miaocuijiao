# Multi payment-confirm Browser UI E2E
Generated: 2026-09-23T21:48:03Z
Staging: https://meow-cuijiao-homepage-staging.vercel.app
Order: **MCJO000248**
Summary: **PASS=6 FAIL=0**

| TEST | RESULT | EVIDENCE | SCREENSHOT |
|---|---|---|---|
| 01_create_multi | PASS | awaiting_payment kids=2 | — |
| 02_browser_payment_channel_proof_ui | PASS | payOrderBtns=0 proofPick=1 proofPanel=1 payInfo=1 | screenshots/01-payment-channel-and-proof-ui.png |
| 03_browser_upload_preview | PASS | previewImgs=1 | screenshots/02-proof-preview-after-pick.png |
| 04_ui_submit_then_pending_cs | PASS | paymentReview=true | screenshots/03-boss-pending-cs-after-ui-submit.png |
| 05_api_companion_blocked_before_cs | PASS | accept=409 | — |
| 06_api_cs_then_waiting_0of2 | PASS | parent=claimed kids=claimed,claimed | — |

Happy path uses Playwright UI clicks + `setInputFiles` on `#mcjDurableProofInput` — does **not** call `submit_payment_proof` API for the upload step.
