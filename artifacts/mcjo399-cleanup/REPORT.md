# MCJO000399 cleanup report

## Checklist
- DELETE_INVALID_MCJO000399 = PASS
- RELATED_TEST_DATA_CLEANED = PASS
- WALLET_ROLLBACK = PASS (held_balance 140 → 70, delta 70)
- EARNINGS_ROLLBACK = PASS (no companion/commission rows existed)
- GMV_ROLLBACK = PASS (root 70 removed from active set)
- PAYMENT_PROOF_GATE = PASS (offline + wired in CS confirm_payment)
- CS_APPROVAL_GATE = PASS (offline + wired in companion accept)
- ILLEGAL_STATUS_TRANSITION_BLOCKED = PASS (offline + transitionOrderStatus)

## Deleted order IDs
- `ef2112e7-7dd1-4395-b39e-d9b2fba918ec` MCJO000399 (root)
- `570eb756-fe1a-4d26-ab4c-5abc30ff6176` MCJO000400 (小灰灰)
- `2f4edc0e-a9a2-4777-b78f-d755e7b50e2f` MCJO000401 (小宏)

## Finance rollback
- Released `wallet_order_holds` id `4826130d-b713-4f26-8446-95d261be671d` amount 70
- Deleted related `wallet_transactions` (hold + release ledger rows for this order)
- Deleted 6 order messages
- No payment_receipts / commissions / referral earnings for this chain

## Wallet (Boss 1717)
- before held_balance: 140
- after held_balance: 70
- paid_balance restored +70 via hold release (never-happened)

## GMV
- before contribution of this root: 70
- after: order NOT FOUND → contribution 0

## Excluded
- MCJO000395 / MCJO000396 (separate tree — not deleted)
