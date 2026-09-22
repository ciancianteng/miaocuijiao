#!/usr/bin/env node
/**
 * Offline unit checks for cat-food hold idempotency keys + pay_order gate strings.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orders = readFileSync(path.join(root, "server/api/orders.js"), "utf8");
const wallet = readFileSync(path.join(root, "server/api/_wallet.js"), "utf8");
const mig = readFileSync(path.join(root, "supabase/migrations/20260922_wallet_order_holds.sql"), "utf8");
const complete = readFileSync(path.join(root, "server/api/_order-complete.js"), "utf8");
const group = readFileSync(path.join(root, "server/api/_order-group.js"), "utf8");

assert.match(wallet, /holdWalletForOrder/);
assert.match(wallet, /finalizeWalletHold/);
assert.match(wallet, /releaseWalletHold/);
assert.match(orders, /holdWalletForOrder/);
assert.match(orders, /order-hold:/);
assert.match(orders, /MANUAL_PAYMENT_REQUIRES_PROOF/);
assert.match(orders, /releaseWalletHold/);
assert.match(orders, /order-release:/);
assert.match(complete, /finalizeWalletHold/);
assert.match(group, /finalizeWalletHold/);
assert.match(mig, /mcj_wallet_hold/);
assert.match(mig, /mcj_wallet_finalize_hold/);
assert.match(mig, /mcj_wallet_release_hold/);
assert.match(mig, /held_balance/);
console.log("verify-catfood-hold-gates: PASS");
