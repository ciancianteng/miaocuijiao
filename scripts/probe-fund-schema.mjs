/**
 * Read-only fund schema probe via PostgREST (no SQL DDL, no password print).
 * node scripts/probe-fund-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const U = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const S = env.SUPABASE_SERVICE_ROLE_KEY;

async function hit(label, pathPart, init = {}) {
  const r = await fetch(`${U}${pathPart}`, {
    ...init,
    headers: {
      apikey: S,
      Authorization: `Bearer ${S}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const t = await r.text();
  const missing = /Could not find|does not exist|schema cache|PGRST202|PGRST205/i.test(t);
  console.log(label, r.status, missing ? "MISSING_OR_RPC" : "OK", t.slice(0, 160).replace(/\s+/g, " "));
  return { status: r.status, missing, text: t };
}

const out = {};
out.wallets = await hit("wallets", "/rest/v1/wallets?select=boss_id,paid_balance,bonus_balance&limit=1");
out.wallet_tx = await hit("wallet_tx", "/rest/v1/wallet_transactions?select=id&limit=1");
out.credit_rpc = await hit("credit_rpc", "/rest/v1/rpc/mcj_wallet_credit_recharge", {
  method: "POST",
  body: JSON.stringify({ p_payment_no: "__probe_missing__", p_provider_trade_no: "", p_idempotency_key: "probe" }),
});
out.debit_rpc = await hit("debit_rpc", "/rest/v1/rpc/mcj_wallet_debit", {
  method: "POST",
  body: JSON.stringify({
    p_boss_id: "00000000-0000-0000-0000-000000000001",
    p_transaction_type: "order_payment",
    p_amount: 1,
    p_idempotency_key: "probe-debit",
  }),
});
out.wd_cols = await hit(
  "wd_bank_reference",
  "/rest/v1/companion_withdrawals?select=id,bank_reference,payment_remark,receipt_url&limit=1"
);
out.admin_role = await hit(
  "admin_role",
  "/rest/v1/profiles?email=eq.admin@meow.test&select=id,role,email,status&limit=1"
);

fs.writeFileSync(path.join(root, "scripts/probe-fund-schema-results.json"), JSON.stringify(out, null, 2));
