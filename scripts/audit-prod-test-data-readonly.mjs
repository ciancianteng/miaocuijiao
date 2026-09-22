#!/usr/bin/env node
/**
 * P0-7 read-only Production test-data audit.
 * Never DELETE / UPDATE / TRUNCATE.
 *
 * Always: public Production vs Staging APIs (no secrets).
 * Optional DB: PROD_SUPABASE_URL (https://jqfaknpmcnqwqvatrwgo.supabase.co)
 *              + PROD_SUPABASE_SERVICE_ROLE_KEY  (REST, Prefer: count)
 *           or postgresql URL with SET default_transaction_read_only=on
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { isTestUsername } from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-7");
fs.mkdirSync(outDir, { recursive: true });

const PROD_APP = "https://www.meowcuijiao.com";
const STAGING_APP = "https://meow-cuijiao-homepage-staging.vercel.app";

const G2_TEST_USERS = [
  { id: "b989960b-ddc2-4f1b-899f-12b2b0cac3b7", email: "boss@meow.test", role: "boss", name: "P0 Boss", reason: "G2 marked is_test_account=true; @meow.test" },
  { id: "d397b7bb-826b-4e7a-8fdf-f14602dd92bb", email: "boss.final.1785714993009@meow.test", role: "boss", name: "Boss Final", reason: "G2 marked; @meow.test" },
  { id: "5f20a7fe-3a48-4b42-82b9-82222bc81311", email: "cs.smoke.1788374622374@meow.test", role: "customer_service", name: "ProdSmokeCS", reason: "G2 marked; smoke CS" },
  { id: "47178368-a3d4-44b3-97fe-8a648d951c66", email: "brnwxnfv@guerrillamailblock.com", role: "companion", name: "ProdSmokeInviter", reason: "G2 marked; guerrilla + ProdSmoke" },
  { id: "ed5054bd-93d2-434a-b468-68f75423d830", email: "swrfscrd@guerrillamailblock.com", role: "companion", name: "ProdSmokeService", reason: "G2 marked; guerrilla + ProdSmoke" },
  { id: "779db97b-9a5d-4a97-8be8-5d7bc6d24109", email: "qemvmuma@guerrillamailblock.com", role: "boss", name: "ProdSmokeBoss", reason: "G2 marked; guerrilla + ProdSmoke" },
  { id: "b9347ea4-3b45-400d-bf8d-ae2fbe05d690", email: "cs.smoke.1788374831089@meow.test", role: "customer_service", name: "ProdSmokeCS", reason: "G2 marked; smoke CS" },
  { id: "6d368f4b-7f33-4923-9441-c63cecef2070", email: "shjqelap@guerrillamailblock.com", role: "companion", name: "ProdSmokeInviter2", reason: "G2 marked; 2026-09-02 OTP smoke" },
  { id: "9f7fb39a-bec8-47cc-974a-e314ac2f5cd5", email: "uuzkxxgk@guerrillamailblock.com", role: "companion", name: "ProdSmokeService2", reason: "G2 marked; 2026-09-02 OTP smoke" },
  { id: "0664ef55-de58-48e3-8dbb-ca8111318e91", email: "ijogepcg@guerrillamailblock.com", role: "boss", name: "ProdSmokeBoss2", reason: "G2 marked; 2026-09-02 OTP smoke" },
];

const KNOWN_ORDERS = [
  { orderNo: "MCJO000344", party: "ProdSmokeBoss2", reason: "contamination report 2026-09-03; G2 SQL impact" },
  { orderNo: "MCJO000343", party: "ProdSmokeService2", reason: "contamination report 2026-09-03" },
  { orderNo: "MCJO000342", party: "ProdSmokeCS", reason: "contamination report 2026-09-03" },
  { id: "8821329f-32c3-48c3-a24f-dde2b3e4d332", party: "ProdSmokeBoss2 → ProdSmokeService2", amount: 6000, reason: "OTP *2 PASS; rebate RM60" },
];

const KNOWN_REFERRALS = [
  { id: "84172b1d-7ba5-48d0-9abc-ee6b928e70da", reason: "OTP *2 inviter/service referral row" },
];

const KNOWN_WITHDRAWALS = [
  { id: "21e042c8-461e-4e82-a491-b5a390b96674", reason: "OTP *2 smoke withdrawal" },
];

const PROTECTED = [
  { id: "6f31b706-11e7-42df-8db1-d2caccd796de", email: "meowcuijiao@gmail.com", reason: "real admin — never delete" },
  { id: "458ce9ad-3425-42b1-ab66-24bca342f971", email: "ciancianteng@gmail.com", reason: "real boss 1717 — never delete" },
];

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function namesOf(body) {
  return (body?.companions || []).map((c) => String(c.name || c.nickname || c.display_name || "")).filter(Boolean);
}

function looksLikeTestName(name) {
  return isTestUsername(name) || /^(?:CompA|AdminComp|Invitee|RejectFlow|IdemFlow|PR\d+Pay|dbg\d+|验收)/u.test(name);
}

async function restSelect(base, key, table, query) {
  const url = `${base.replace(/\/$/, "")}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${table} HTTP ${res.status} ${String(text).slice(0, 200)}`);
  return Array.isArray(body) ? body : [];
}

async function optionalDbScan() {
  const url = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return { skipped: true, reason: "no Production REST credentials in this process" };
  if (!url.toLowerCase().includes(PRODUCTION_SUPABASE_REF)) {
    return { skipped: true, reason: `refusing non-Production URL (need ${PRODUCTION_SUPABASE_REF})` };
  }
  const ids = G2_TEST_USERS.map((u) => u.id);
  const inList = `(${ids.join(",")})`;
  const profiles = await restSelect(url, key, "profiles", `?id=in.${inList}&select=id,role,email,display_name,status,is_test_account,created_at`);
  const orders = await restSelect(
    url,
    key,
    "orders",
    `?or=(boss_id.in.${inList},companion_id.in.${inList},customer_service_id.in.${inList})&select=id,order_no,status,total_amount,boss_id,companion_id,customer_service_id,created_at&limit=200`
  );
  let reviews = [];
  let wallets = [];
  let walletTx = [];
  let referrals = [];
  let withdrawals = [];
  try {
    reviews = await restSelect(url, key, "companion_reviews", `?or=(boss_id.in.${inList},companion_id.in.${inList})&select=id,order_id,boss_id,companion_id,rating,created_at&limit=200`);
  } catch (e) {
    reviews = [{ error: String(e.message || e) }];
  }
  try {
    wallets = await restSelect(url, key, "wallets", `?or=(boss_id.in.${inList},user_id.in.${inList})&select=id,boss_id,user_id,balance,created_at&limit=200`);
  } catch (e) {
    wallets = [{ error: String(e.message || e) }];
  }
  try {
    walletTx = await restSelect(url, key, "wallet_transactions", `?or=(boss_id.in.${inList},user_id.in.${inList})&select=id,boss_id,user_id,amount,created_at&limit=200`);
  } catch (e) {
    walletTx = [{ error: String(e.message || e) }];
  }
  try {
    referrals = await restSelect(url, key, "companion_referrals", `?or=(inviter_id.in.${inList},invitee_id.in.${inList})&select=id,inviter_id,invitee_id,created_at&limit=200`);
  } catch {
    referrals = [];
  }
  try {
    withdrawals = await restSelect(url, key, "companion_withdrawals", `?companion_id=in.${inList}&select=id,companion_id,amount_rm,status,created_at&limit=200`);
  } catch {
    withdrawals = [];
  }
  return {
    skipped: false,
    profiles,
    orders,
    reviews,
    wallets,
    walletTx,
    referrals,
    withdrawals,
  };
}

async function main() {
  const [prodHall, stgHall, prodStats, stgStats] = await Promise.all([
    fetchJson(`${PROD_APP}/api/public/companions`),
    fetchJson(`${STAGING_APP}/api/public/companions`),
    fetchJson(`${PROD_APP}/api/home/daily-stats`),
    fetchJson(`${STAGING_APP}/api/home/daily-stats`),
  ]);

  const prodNames = namesOf(prodHall.body);
  const stgNames = namesOf(stgHall.body);
  const prodTestNames = prodNames.filter(looksLikeTestName);
  const stgTestNames = stgNames.filter(looksLikeTestName);

  const db = await optionalDbScan();

  const report = {
    generatedAt: new Date().toISOString(),
    wroteNothing: true,
    productionApp: PROD_APP,
    stagingApp: STAGING_APP,
    productionSupabaseRef: PRODUCTION_SUPABASE_REF,
    stagingSupabaseRef: STAGING_SUPABASE_REF,
    protectedRealAccounts: PROTECTED,
    TEST_USERS: {
      count: G2_TEST_USERS.length,
      source: "G2 APPLIED 2026-09-06 + contamination report (not guessed by nickname)",
      rows: G2_TEST_USERS,
      liveDb: db.skipped ? db : db.profiles,
    },
    TEST_ORDERS: {
      countKnown: KNOWN_ORDERS.length,
      liveStatsExcludedOrders: prodStats.body?.filter?.excludedOrders ?? null,
      rows: KNOWN_ORDERS,
      liveDb: db.skipped ? db : db.orders,
    },
    TEST_WALLET_RECORDS: {
      count: db.skipped ? "pending SQL" : (db.wallets || []).length,
      liveDb: db.skipped ? db : { wallets: db.wallets, tx: db.walletTx },
    },
    TEST_RECHARGES: {
      count: "pending SQL (payment_orders / recharge_orders for the 10 ids)",
      reason: "no public API; listed in P0_7_TEST_DATA_CLEANUP.sql",
    },
    TEST_REVIEWS: {
      count: db.skipped ? "pending SQL" : (db.reviews || []).length,
      liveDb: db.skipped ? db : db.reviews,
    },
    TEST_COMMISSIONS: {
      count: "pending SQL (companion_earnings for smoke order 8821329f-… rebate RM60)",
      relatedOrder: "8821329f-32c3-48c3-a24f-dde2b3e4d332",
    },
    TEST_REFERRALS: {
      count: KNOWN_REFERRALS.length,
      rows: KNOWN_REFERRALS,
      liveDb: db.skipped ? db : db.referrals,
    },
    OTHER_TEST_DATA: {
      withdrawals: KNOWN_WITHDRAWALS,
      liveWithdrawals: db.skipped ? db : db.withdrawals,
    },
    publicSurfaces: {
      productionHallCount: prodNames.length,
      productionHallNames: prodNames,
      productionHallTestNames: prodTestNames,
      stagingHallCount: stgNames.length,
      stagingHallTestNames: stgTestNames,
      productionStats: prodStats.body?.filter || prodStats.body,
      stagingStatsFilter: stgStats.body?.filter || null,
      differentDatabases: prodNames.join("|") !== stgNames.join("|"),
    },
  };

  const outFile = path.join(outDir, "audit.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    outFile,
    prodHall: prodNames.length,
    prodTestOnHall: prodTestNames,
    stgTestOnHallCount: stgTestNames.length,
    excludedOrders: report.TEST_ORDERS.liveStatsExcludedOrders,
    dbScan: db.skipped ? db.reason : "ran",
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
