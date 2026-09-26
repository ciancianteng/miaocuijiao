#!/usr/bin/env node
/**
 * Rollback ONE invalid gift for Boss 1717 (gift_transactions id fixed).
 *
 * DRY RUN (default):
 *   node scripts/cleanup-boss-1717-zero-gift-prod.mjs
 *
 * APPLY (requires human flags):
 *   ALLOW_PROD_MUTATION=1 CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK \
 *   CONFIRM_DELETE=1394fe0f-3534-482c-8c8f-da25837e47d3 \
 *   node scripts/cleanup-boss-1717-zero-gift-prod.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-gift-zero-balance");
fs.mkdirSync(outDir, { recursive: true });

const GIFT_TX_ID = "1394fe0f-3534-482c-8c8f-da25837e47d3";
const BOSS_ID = "458ce9ad-3425-42b1-ab66-24bca342f971";
const WALLET_TX_ID = "618c00aa-d173-4174-b3e1-e9d69d9f14da";
const INCOME_TX_ID = "abca2342-5118-4802-8ea9-2078d8e10e14";
const COMPANION_ID = "0daa3089-ab2c-4364-919d-08e2fad2af36";
const GROSS = 20;
const NET = 4;

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !/\[SENSITIVE\]/i.test(v)) o[m[1]] = v;
  }
  return o;
}

const env = {
  ...parseEnv(path.join(root, ".env.local")),
  ...parseEnv(path.join(root, ".env.vercel.prod.pull.tmp")),
  ...parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local")),
};
const url = String(env.PROD_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
const ref = url ? new URL(url).hostname.split(".")[0] : "";
if (ref !== PRODUCTION_SUPABASE_REF) {
  console.error("Ref mismatch", ref);
  process.exit(2);
}

const apply =
  process.env.ALLOW_PROD_MUTATION === "1" &&
  process.env.CONFIRM_PROD_MUTATION === "I_UNDERSTAND_PROD_RISK" &&
  process.env.CONFIRM_DELETE === GIFT_TX_ID;

async function rest(table, q, init = {}) {
  const r = await fetch(`${url}/rest/v1/${table}${q}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    ...init,
  });
  const t = await r.text();
  let b;
  try {
    b = t ? JSON.parse(t) : null;
  } catch {
    b = t;
  }
  if (!r.ok) throw new Error(`${r.status} ${table}: ${typeof b === "string" ? b : JSON.stringify(b)}`);
  return b;
}

async function rpc(fn, body) {
  return rest(`rpc/${fn}`, "", { method: "POST", body: JSON.stringify(body) });
}

const gift = (await rest("gift_transactions", `?id=eq.${GIFT_TX_ID}&select=*`))?.[0];
const walletTx = (await rest("wallet_transactions", `?id=eq.${WALLET_TX_ID}&select=*`))?.[0];
const income = (await rest("transactions", `?id=eq.${INCOME_TX_ID}&select=*`))?.[0];
const wall = await rest(
  "companion_gift_wall",
  `?companion_id=eq.${COMPANION_ID}&gift_id=eq.ca332b7d-aeed-4d0f-a990-b397159c724e&select=*`
);
const walletBefore = (await rest("wallets", `?boss_id=eq.${BOSS_ID}&select=*`))?.[0];

const plan = {
  mode: apply ? "APPLY" : "DRY_RUN",
  gift,
  walletTx,
  income,
  wall,
  walletBefore,
  actions: [
    `DELETE gift_transactions id=${GIFT_TX_ID}`,
    `DELETE transactions (companion income) id=${INCOME_TX_ID}`,
    `DELETE wallet_transactions id=${WALLET_TX_ID}`,
    `CREDIT wallet +${GROSS} (refund gift) via mcj_wallet_credit`,
    `PATCH companion_gift_wall qty-=1 or delete if 0`,
  ],
};

fs.writeFileSync(path.join(outDir, "CLEANUP_PLAN.json"), JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ mode: plan.mode, giftExists: !!gift, walletTxExists: !!walletTx, incomeExists: !!income, wall, walletBefore }, null, 2));

if (!apply) {
  console.log("DRY RUN only. Set ALLOW_PROD_MUTATION=1 CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK CONFIRM_DELETE=" + GIFT_TX_ID);
  process.exit(0);
}

if (!gift) {
  console.log("Gift already gone");
  process.exit(0);
}

const results = { steps: [] };

if (income) {
  await rest("transactions", `?id=eq.${INCOME_TX_ID}`, { method: "DELETE" });
  results.steps.push({ deleteIncome: INCOME_TX_ID, ok: true });
}

if (walletTx) {
  await rest("wallet_transactions", `?id=eq.${WALLET_TX_ID}`, { method: "DELETE" });
  results.steps.push({ deleteWalletTx: WALLET_TX_ID, ok: true });
}

await rest("gift_transactions", `?id=eq.${GIFT_TX_ID}`, { method: "DELETE" });
results.steps.push({ deleteGift: GIFT_TX_ID, ok: true });

// Refund boss
const credit = await rpc("mcj_wallet_credit", {
  p_boss_id: BOSS_ID,
  p_transaction_type: "refund",
  p_amount: GROSS,
  p_balance_type: "paid",
  p_idempotency_key: `p0-gift-zero-rollback:${GIFT_TX_ID}`,
  p_reason: "P0 rollback invalid gift test 小铃铛×1",
  p_internal_note: "cleanup-boss-1717-zero-gift-prod",
  p_operator_id: BOSS_ID,
  p_related_order_id: null,
  p_related_recharge_id: null,
  p_campaign_id: null,
  p_compensation_id: null,
  p_expires_at: null,
  p_recharge_rm: 0,
});
results.steps.push({ creditRefund: GROSS, result: credit });

const wallRow = wall?.[0];
if (wallRow) {
  const nextQty = Math.max(0, Number(wallRow.total_quantity || 0) - 1);
  if (nextQty <= 0) {
    await rest(
      "companion_gift_wall",
      `?companion_id=eq.${COMPANION_ID}&gift_id=eq.ca332b7d-aeed-4d0f-a990-b397159c724e`,
      { method: "DELETE" }
    );
    results.steps.push({ giftWall: "deleted" });
  } else {
    await rest(
      "companion_gift_wall",
      `?companion_id=eq.${COMPANION_ID}&gift_id=eq.ca332b7d-aeed-4d0f-a990-b397159c724e`,
      { method: "PATCH", body: JSON.stringify({ total_quantity: nextQty, updated_at: new Date().toISOString() }) }
    );
    results.steps.push({ giftWall: "qty=" + nextQty });
  }
}

const after = {
  gift: await rest("gift_transactions", `?id=eq.${GIFT_TX_ID}&select=id`),
  income: await rest("transactions", `?id=eq.${INCOME_TX_ID}&select=id`),
  walletTx: await rest("wallet_transactions", `?id=eq.${WALLET_TX_ID}&select=id`),
  wallet: await rest("wallets", `?boss_id=eq.${BOSS_ID}&select=*`),
  wall: await rest(
    "companion_gift_wall",
    `?companion_id=eq.${COMPANION_ID}&gift_id=eq.ca332b7d-aeed-4d0f-a990-b397159c724e&select=*`
  ),
};

results.after = after;
fs.writeFileSync(path.join(outDir, "CLEANUP_RESULT.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
