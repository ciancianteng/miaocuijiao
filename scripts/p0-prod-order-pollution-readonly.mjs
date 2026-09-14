/**
 * READ-ONLY Production order pollution audit.
 * GET/SELECT only. Never insert/update/delete. Never places orders.
 *
 * Usage:
 *   node scripts/p0-prod-order-pollution-readonly.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REAL_BOSS_ID = "458ce9ad-3425-42b1-ab66-24bca342f971";
const ORDER_NOS = [
  "MCJO000345",
  "MCJO000346",
  "MCJO000347",
  "MCJO000348",
  "MCJO000349",
  "MCJO000350",
  "MCJO000351",
  "MCJO000352",
  "MCJO000353",
  "MCJO000354",
  "MCJO000355",
  "MCJ0000345",
  "MCJ0000346",
  "MCJ0000347",
  "MCJ0000348",
  "MCJ0000349",
  "MCJ0000350",
  "MCJ0000351",
  "MCJ0000352",
  "MCJ0000353",
  "MCJ0000354",
  "MCJ0000355",
];

function loadEnvFile(name) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const URL = String(
  process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
).replace(/\/$/, "");
const KEY = String(
  process.env.PROD_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
).trim();

function headers() {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function rest(pathname) {
  const res = await fetch(`${URL}${pathname}`, { method: "GET", headers: headers() });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: String(text).slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(`GET ${pathname} -> ${res.status} ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 400)}`);
  }
  return Array.isArray(body) ? body : body ? [body] : [];
}

function pick(row, keys) {
  const out = {};
  for (const k of keys) out[k] = row?.[k] ?? null;
  return out;
}

async function trySelect(table, query) {
  try {
    return await rest(`/rest/v1/${table}${query}`);
  } catch (e) {
    return { error: String(e.message || e).slice(0, 500) };
  }
}

async function main() {
  const ref = supabaseProjectRef(URL);
  if (!URL || !KEY) {
    console.error("MISSING_CREDS");
    process.exit(2);
  }
  if (ref !== PRODUCTION_SUPABASE_REF) {
    console.error(`REFUSED_NON_PROD ref=${ref || "(empty)"} expected=${PRODUCTION_SUPABASE_REF}`);
    process.exit(2);
  }

  const sample = await trySelect("orders", "?select=*&order=created_at.desc&limit=1");
  const sampleCols = Array.isArray(sample) && sample[0] ? Object.keys(sample[0]) : [];
  const wanted = [
    "id",
    "order_no",
    "created_at",
    "updated_at",
    "boss_id",
    "companion_id",
    "customer_service_id",
    "status",
    "payment_method",
    "total_amount",
    "unit_price",
    "hours",
    "game",
    "title",
    "description",
    "note",
    "order_type",
    "assignment_type",
    "idempotency_key",
    "is_test",
    "paid_at",
    "completed_at",
    "player_income",
    "companion_income",
    "platform_fee",
    "platform_commission",
    "created_by",
  ];
  const orderSelect = (sampleCols.length ? wanted.filter((k) => sampleCols.includes(k)) : wanted.slice(0, 12)).join(",");

  const inNos = ORDER_NOS.map(encodeURIComponent).join(",");
  const byNo = await trySelect("orders", `?order_no=in.(${inNos})&select=${orderSelect}`);
  const recent = await trySelect("orders", `?select=${orderSelect}&order=created_at.desc&limit=40`);
  const byBoss = await trySelect(
    "orders",
    `?boss_id=eq.${REAL_BOSS_ID}&select=${orderSelect}&order=created_at.desc&limit=40`
  );
  const byComp = await trySelect(
    "orders",
    `?companion_id=eq.${REAL_BOSS_ID}&select=${orderSelect}&order=created_at.desc&limit=40`
  );

  const profileIds = new Set();
  for (const list of [byNo, recent, byBoss, byComp]) {
    if (Array.isArray(list)) {
      for (const o of list) {
        if (o.boss_id) profileIds.add(o.boss_id);
        if (o.companion_id) profileIds.add(o.companion_id);
        if (o.customer_service_id) profileIds.add(o.customer_service_id);
      }
    }
  }
  const idList = [...profileIds].map(encodeURIComponent).join(",");
  let profiles = [];
  if (idList) {
    profiles = await trySelect(
      "profiles",
      `?id=in.(${idList})&select=id,role,roles,email,display_name,nickname,boss_uid,is_test_account,is_test,status`
    );
    if (profiles.error) {
      profiles = await trySelect(
        "profiles",
        `?id=in.(${idList})&select=id,role,email,display_name,boss_uid,status`
      );
    }
  }
  const companions = idList
    ? await trySelect(
        "companion_profiles",
        `?user_id=in.(${idList})&select=user_id,nickname,companion_uid,is_test_account,verification_status`
      )
    : [];

  const orderIds = [];
  for (const list of [byNo, byBoss, byComp, recent]) {
    if (Array.isArray(list)) for (const o of list) if (o.id) orderIds.push(o.id);
  }
  const uniqOrderIds = [...new Set(orderIds)];
  const oidIn = uniqOrderIds.slice(0, 80).map(encodeURIComponent).join(",");

  const wallet = oidIn
    ? await trySelect(
        "wallet_transactions",
        `?related_order_id=in.(${oidIn})&select=id,user_id,boss_id,amount,transaction_type,reason,related_order_id,created_at&limit=200`
      )
    : [];
  const walletAlt =
    wallet.error && oidIn
      ? await trySelect(
          "wallet_ledger",
          `?order_id=in.(${oidIn})&select=id,user_id,amount,type,reason,order_id,created_at&limit=200`
        )
      : wallet;

  const earnings = oidIn
    ? await trySelect(
        "companion_earnings",
        `?order_id=in.(${oidIn})&select=id,companion_id,order_id,amount,status,created_at&limit=200`
      )
    : [];
  const settlements = oidIn
    ? await trySelect(
        "settlements",
        `?order_id=in.(${oidIn})&select=id,order_id,amount,status,created_at&limit=200`
      )
    : [];
  const notifs = oidIn
    ? await trySelect(
        "notifications",
        `?order_id=in.(${oidIn})&select=id,user_id,title,body,order_id,created_at&limit=200`
      )
    : [];

  const walletSample = await trySelect("wallet_transactions", "?select=*&limit=1");
  const walletCols = Array.isArray(walletSample) && walletSample[0] ? Object.keys(walletSample[0]) : [];
  const walletByBoss = await trySelect(
    "wallet_transactions",
    `?boss_id=eq.${REAL_BOSS_ID}&order=created_at.desc&limit=40`
  );
  const walletsRow = await trySelect("wallets", `?boss_id=eq.${REAL_BOSS_ID}&select=*&limit=5`);
  const walletByOrder = oidIn
    ? await trySelect("wallet_transactions", `?related_order_id=in.(${oidIn})&select=*&limit=80`)
    : [];

  const completedOn1717 = Array.isArray(byBoss)
    ? byBoss.filter((o) => String(o.status || "") === "completed" || String(o.payment_status || "") === "completed")
    : [];
  const completedAsComp = Array.isArray(byComp)
    ? byComp.filter((o) => String(o.status || "") === "completed")
    : [];

  const report = {
    at: new Date().toISOString(),
    supabaseRef: ref,
    mode: "GET_ONLY",
    realAccount: {
      id: REAL_BOSS_ID,
      display_name: "1717",
      boss_uid: "MCJ00015",
      companion_public_id: "PW00021",
    },
    queriedOrderNos: ORDER_NOS,
    orderColumns: sampleCols,
    ordersByExactNo: Array.isArray(byNo) ? byNo : { error: byNo.error },
    recent40: Array.isArray(recent) ? recent : { error: recent.error },
    ordersWhere1717IsBoss: Array.isArray(byBoss) ? byBoss : { error: byBoss.error },
    ordersWhere1717IsCompanion: Array.isArray(byComp) ? byComp : { error: byComp.error },
    completedAsBoss: completedOn1717,
    completedAsCompanion: completedAsComp,
    profiles: Array.isArray(profiles)
      ? profiles.map((p) => ({
          ...pick(p, ["id", "role", "roles", "display_name", "nickname", "boss_uid", "is_test_account", "is_test", "status"]),
          emailDomain: String(p.email || "").includes("@") ? String(p.email).split("@")[1] : null,
          emailIsOwnerGmail: String(p.email || "").toLowerCase() === "ciancianteng@gmail.com",
        }))
      : { error: profiles.error },
    companionProfiles: Array.isArray(companions) ? companions : { error: companions.error },
    wallet: Array.isArray(walletAlt) ? walletAlt : { error: walletAlt.error || wallet.error },
    walletColumns: walletCols,
    walletByBoss1717: Array.isArray(walletByBoss) ? walletByBoss : { error: walletByBoss.error },
    walletByOrder: Array.isArray(walletByOrder) ? walletByOrder : { error: walletByOrder.error },
    walletBalance1717: Array.isArray(walletsRow) ? walletsRow : { error: walletsRow.error },
    companionEarnings: Array.isArray(earnings) ? earnings : { error: earnings.error },
    settlements: Array.isArray(settlements) ? settlements : { error: settlements.error },
    notifications: Array.isArray(notifs) ? notifs : { error: notifs.error },
  };

  const outDir = path.join(ROOT, "artifacts", "security");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "prod-order-pollution-audit.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log("WROTE", outFile);
  console.log(
    JSON.stringify(
      {
        exactNoCount: Array.isArray(byNo) ? byNo.length : byNo.error,
        recentCount: Array.isArray(recent) ? recent.length : recent.error,
        boss1717Count: Array.isArray(byBoss) ? byBoss.length : byBoss.error,
        companion1717Count: Array.isArray(byComp) ? byComp.length : byComp.error,
        completedBoss: completedOn1717.map((o) => o.order_no),
        completedComp: completedAsComp.map((o) => o.order_no),
        orderColumns: sampleCols,
        recentNos: Array.isArray(recent) ? recent.slice(0, 15).map((o) => `${o.order_no}|${o.status}|${o.total_amount}|boss=${String(o.boss_id||"").slice(0,8)}`) : [],
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e).slice(0, 1500));
  process.exit(1);
});
