#!/usr/bin/env node
/**
 * READONLY audit: Boss 1717 recent gift / wallet / income records on Production.
 * Never INSERT/UPDATE/DELETE.
 *
 * TARGET=prod node scripts/audit-boss-1717-gift-zero-readonly.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-gift-zero-balance");
fs.mkdirSync(outDir, { recursive: true });

const BOSS_ID = "458ce9ad-3425-42b1-ab66-24bca342f971";
const BOSS_UID = 1717;
const TARGET = String(process.env.TARGET || "prod").toLowerCase();

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

function loadEnv() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, ".env.vercel.prod.pull.tmp"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    path.join(root, "../meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local"),
    path.join(root, ".env.staging.local"),
    path.join(root, ".env.vercel.staging.pull"),
  ];
  let merged = {};
  for (const p of candidates) {
    for (const [k, v] of Object.entries(parseEnv(p))) {
      if (!merged[k]) merged[k] = v;
    }
  }
  return merged;
}

const env = loadEnv();
const url = String(
  TARGET === "staging"
    ? env.STAGING_SUPABASE_URL || env.SUPABASE_URL_STAGING || ""
    : env.PROD_SUPABASE_URL || env.SUPABASE_URL || ""
).replace(/\/$/, "");
const key = String(
  TARGET === "staging"
    ? env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""
    : env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""
);
const ref = url ? new URL(url).hostname.split(".")[0] : "";
const expected = TARGET === "staging" ? STAGING_SUPABASE_REF : PRODUCTION_SUPABASE_REF;

if (!url || !key) {
  console.error("Missing Supabase URL/key");
  process.exit(2);
}
if (ref !== expected) {
  console.error(`Ref mismatch: got ${ref}, expected ${expected}`);
  process.exit(2);
}

async function rest(table, query) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, body, error: String(body?.message || text || res.status) };
  }
  return { ok: true, rows: Array.isArray(body) ? body : body ? [body] : [] };
}

const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

const profiles = await rest(
  "profiles",
  `?or=(id.eq.${BOSS_ID},boss_uid.eq.${BOSS_UID},display_name.eq.1717)&select=id,boss_uid,public_id,display_name,nickname,role&limit=5`
);
const boss = profiles.rows?.[0] || { id: BOSS_ID, boss_uid: BOSS_UID };
if (!boss?.id) {
  console.error("Boss 1717 not found", profiles);
  process.exit(1);
}

const wallet = await rest(
  "wallets",
  `?user_id=eq.${encodeURIComponent(boss.id)}&select=*&limit=5`
).catch(() => ({ ok: false, rows: [] }));
const walletAlt = await rest(
  "boss_wallets",
  `?boss_id=eq.${encodeURIComponent(boss.id)}&select=*&limit=5`
).catch(() => ({ ok: false, rows: [] }));

const giftTx = await rest(
  "gift_transactions",
  `?sender_boss_id=eq.${encodeURIComponent(boss.id)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`
);
const giftOrders = await rest(
  "gift_orders",
  `?sender_boss_id=eq.${encodeURIComponent(boss.id)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`
);
const walletTx = await rest(
  "wallet_transactions",
  `?or=(boss_id.eq.${encodeURIComponent(boss.id)},user_id.eq.${encodeURIComponent(boss.id)})&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`
).catch(() => ({ ok: false, rows: [], error: "wallet_transactions missing" }));
const walletTx2 = await rest(
  "transactions",
  `?user_id=eq.${encodeURIComponent(boss.id)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=50`
);

const companionIds = [
  ...new Set([
    ...(giftTx.rows || []).map((r) => r.receiver_companion_id),
    ...(giftOrders.rows || []).map((r) => r.receiver_companion_id),
  ].filter(Boolean)),
];

const companionIncome = [];
for (const cid of companionIds) {
  const rows = await rest(
    "transactions",
    `?user_id=eq.${encodeURIComponent(cid)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=30`
  );
  companionIncome.push({ companionId: cid, ok: rows.ok, rows: rows.rows || [], error: rows.error });
}

const giftWall = [];
for (const cid of companionIds) {
  const rows = await rest(
    "companion_gift_wall",
    `?companion_id=eq.${encodeURIComponent(cid)}&select=*&order=updated_at.desc&limit=20`
  );
  giftWall.push({ companionId: cid, ok: rows.ok, rows: rows.rows || [], error: rows.error });
}

const notifsBoss = await rest(
  "boss_notifications",
  `?boss_id=eq.${encodeURIComponent(boss.id)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=30`
).catch(() => ({ ok: false, rows: [] }));

const report = {
  target: TARGET,
  ref,
  since,
  boss: { id: boss.id, uid: boss.uid, public_id: boss.public_id, name: boss.nickname || boss.display_name },
  wallet: wallet.rows || [],
  walletAlt: walletAlt.rows || [],
  gift_transactions: giftTx.rows || [],
  gift_orders: giftOrders.rows || [],
  wallet_transactions: walletTx.rows || walletTx.error || null,
  boss_transactions: walletTx2.rows || [],
  companion_income: companionIncome,
  gift_wall: giftWall,
  boss_notifications: notifsBoss.rows || [],
  suspects: (giftTx.rows || []).filter((r) => Number(r.gross_cat_food || r.gross_amount || 0) === 20),
};

fs.writeFileSync(path.join(outDir, "AUDIT_prod_1717_gifts.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  bossId: boss.id,
  wallet: report.wallet,
  walletAlt: report.walletAlt,
  giftTxCount: report.gift_transactions.length,
  giftOrderCount: report.gift_orders.length,
  suspect20: report.suspects.map((r) => ({
    id: r.id,
    gift: r.gift_name,
    gross: r.gross_cat_food || r.gross_amount,
    companion: r.receiver_companion_id,
    created: r.created_at,
    payment: r.payment_method,
  })),
  giftOrders: report.gift_orders.map((r) => ({
    id: r.id,
    status: r.status,
    gift: r.gift_name_snapshot,
    total: r.total_amount,
    companion: r.receiver_companion_id,
    created: r.created_at,
  })),
}, null, 2));
