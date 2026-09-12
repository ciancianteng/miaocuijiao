/**
 * Quick CS reward + withdrawal_no probe for a completed settle order / withdraw id.
 * node scripts/probe-fund-extras.mjs --order=UUID --withdraw=UUID
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
const orderId = process.argv.find((a) => a.startsWith("--order="))?.slice(8) || "";
const withdrawId = process.argv.find((a) => a.startsWith("--withdraw="))?.slice(11) || "";

async function rest(table, qs) {
  const r = await fetch(`${U}/rest/v1/${table}${qs}`, {
    headers: { apikey: S, Authorization: `Bearer ${S}`, Accept: "application/json" },
  });
  const t = await r.text();
  const j = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${table} ${r.status} ${t.slice(0, 200)}`);
  return j;
}

const out = {};
if (orderId) {
  out.order = (await rest("orders", `?id=eq.${orderId}&select=id,order_no,status,total_amount,customer_service_id`))?.[0];
  out.income = await rest(
    "transactions",
    `?order_id=eq.${orderId}&transaction_type=eq.companion_income&select=id,amount,note,user_id`
  ).catch(() => []);
  out.csReward = await rest("cs_dock_rewards", `?order_id=eq.${orderId}&select=*`).catch((e) => [{ error: e.message }]);
}
if (withdrawId) {
  out.withdraw = (
    await rest(
      "companion_withdrawals",
      `?id=eq.${withdrawId}&select=id,withdrawal_no,status,cat_food_amount,bank_reference,receipt_url,paid_at,completed_at`
    )
  )?.[0];
}
console.log(JSON.stringify(out, null, 2));
