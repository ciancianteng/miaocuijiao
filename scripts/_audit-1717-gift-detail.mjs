#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-gift-zero-balance");
fs.mkdirSync(outDir, { recursive: true });

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
const boss = "458ce9ad-3425-42b1-ab66-24bca342f971";
const giftId = "1394fe0f-3534-482c-8c8f-da25837e47d3";
const companion = "0daa3089-ab2c-4364-919d-08e2fad2af36";

async function rest(table, q) {
  const r = await fetch(`${url}/rest/v1/${table}${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const t = await r.text();
  let b;
  try {
    b = JSON.parse(t);
  } catch {
    b = t;
  }
  return { status: r.status, b };
}

const out = {
  wallets: await rest("wallets", `?boss_id=eq.${boss}&select=*`),
  gift: await rest("gift_transactions", `?id=eq.${giftId}&select=*`),
  walletTx: await rest(
    "wallet_transactions",
    `?boss_id=eq.${boss}&order=created_at.desc&limit=30`
  ),
  companionIncome: await rest(
    "transactions",
    `?user_id=eq.${companion}&order=created_at.desc&limit=30`
  ),
  giftWall: await rest("companion_gift_wall", `?companion_id=eq.${companion}&select=*`),
  companion: await rest(
    "companion_profiles",
    `?user_id=eq.${companion}&select=user_id,nickname,companion_uid,gift_commission_rate`
  ),
  notifs: await rest(
    "boss_notifications",
    `?boss_id=eq.${boss}&order=created_at.desc&limit=15`
  ),
  compNotifs: await rest(
    "companion_notifications",
    `?or=(companion_id.eq.${companion},user_id.eq.${companion})&order=created_at.desc&limit=15`
  ),
};

fs.writeFileSync(path.join(outDir, "AUDIT_DETAIL.json"), JSON.stringify(out, null, 2));

const g = out.gift.b?.[0] || {};
const summary = {
  wallet: out.wallets.b,
  gift: {
    id: g.id,
    gift: g.gift_name,
    gross: g.gross_cat_food ?? g.gross_amount,
    income: g.companion_income ?? g.net_companion_income,
    commission: g.platform_commission_amount ?? g.platform_commission,
    wallet_tx: g.wallet_transaction_id,
    settlement: g.settlement_transaction_id,
    created: g.created_at,
    idem: g.idempotency_key,
    payment: g.payment_method,
  },
  walletTxAroundGift: (out.walletTx.b || []).filter((t) => {
    const ts = Date.parse(t.created_at || 0);
    const gt = Date.parse(g.created_at || 0);
    return Math.abs(ts - gt) < 120000 || /gift|小|礼物/i.test(String(t.reason || "") + String(t.transaction_type || ""));
  }),
  walletTxRecent: (out.walletTx.b || []).slice(0, 8).map((t) => ({
    id: t.id,
    type: t.transaction_type,
    amt: t.amount,
    dir: t.direction,
    idem: t.idempotency_key,
    created: t.created_at,
    total_after: t.total_balance_after,
  })),
  companionGiftIncome: (out.companionIncome.b || []).filter((t) =>
    /礼物|gift|MCJ_GIFT/i.test(String(t.note || "") + String(t.transaction_type || ""))
  ),
  giftWall: out.giftWall.b,
  companion: out.companion.b,
  diagnosis:
    !g.wallet_transaction_id
      ? "CRITICAL: gift_transaction created WITHOUT wallet_transaction_id — debit may have been skipped or failed silently"
      : "has wallet_transaction_id",
};

fs.writeFileSync(path.join(outDir, "AUDIT_SUMMARY.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
