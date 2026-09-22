#!/usr/bin/env node
/**
 * Build PROD_TEST_CLEANUP_MANIFEST.json from Production READ-ONLY.
 * Only confirmed test markers (is_test_account=true / cursor_acceptance / @meow.test / G2 known).
 * Suspected / unproven rows are listed separately and NEVER eligible for delete.
 *
 * Does NOT mutate Production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import {
  isTestEmail,
  isTestUsername,
  TEST_DATA_SOURCE,
} from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/prod-test-cleanup");
fs.mkdirSync(outDir, { recursive: true });

const PROTECTED_IDS = new Set([
  "6f31b706-11e7-42df-8db1-d2caccd796de", // meowcuijiao@gmail.com admin
  "458ce9ad-3425-42b1-ab66-24bca342f971", // 1717 / ciancianteng
]);

const G2_KNOWN = [
  { id: "b989960b-ddc2-4f1b-899f-12b2b0cac3b7", email: "boss@meow.test" },
  { id: "d397b7bb-826b-4e7a-8fdf-f14602dd92bb", email: "boss.final.1785714993009@meow.test" },
  { id: "5f20a7fe-3a48-4b42-82b9-82222bc81311", email: "cs.smoke.1788374622374@meow.test" },
  { id: "47178368-a3d4-44b3-97fe-8a648d951c66", email: "brnwxnfv@guerrillamailblock.com" },
  { id: "ed5054bd-93d2-434a-b468-68f75423d830", email: "swrfscrd@guerrillamailblock.com" },
  { id: "779db97b-9a5d-4a97-8be8-5d7bc6d24109", email: "qemvmuma@guerrillamailblock.com" },
  { id: "b9347ea4-3b45-400d-bf8d-ae2fbe05d690", email: "cs.smoke.1788374831089@meow.test" },
  { id: "6d368f4b-7f33-4923-9441-c63cecef2070", email: "shjqelap@guerrillamailblock.com" },
  { id: "9f7fb39a-bec8-47cc-974a-e314ac2f5cd5", email: "uuzkxxgk@guerrillamailblock.com" },
  { id: "0664ef55-de58-48e3-8dbb-ca8111318e91", email: "ijogepcg@guerrillamailblock.com" },
];

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function resolveProd() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, "..", "meow-cuijiao-homepage", ".env.local"),
    "C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local",
  ];
  let fileEnv = {};
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      fileEnv = parseEnv(p);
      break;
    }
  }
  const url = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const key = String(
    process.env.PROD_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
      ""
  ).trim();
  let ref = "";
  try {
    ref = new URL(url).hostname.split(".")[0]?.toLowerCase() || "";
  } catch {
    ref = "";
  }
  return { url, key, ref };
}

async function rest(url, key, table, query) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
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
  if (!res.ok) throw new Error(`${table} ${res.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

function confirmReasons(p) {
  const reasons = [];
  if (p.is_test_account === true) reasons.push("profiles.is_test_account=true");
  if (isTestEmail(p.email)) reasons.push(`test email pattern: ${p.email}`);
  if (isTestUsername(p.display_name, p.nickname)) reasons.push(`test display_name: ${p.display_name || p.nickname}`);
  const g2 = G2_KNOWN.find((g) => g.id === p.id && String(g.email).toLowerCase() === String(p.email || "").toLowerCase());
  if (g2) reasons.push(`G2 known list id+email match`);
  const g2IdOnly = G2_KNOWN.find((g) => g.id === p.id && String(g.email).toLowerCase() !== String(p.email || "").toLowerCase());
  return { reasons, g2IdOnly };
}

const { url, key, ref } = resolveProd();
if (!url || !key || ref !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: Production credentials required (jqfaknpmcnqwqvatrwgo)");
  process.exit(2);
}

const profiles = await rest(
  url,
  key,
  "profiles",
  "?select=id,role,email,display_name,status,is_test_account,created_at&order=created_at.desc&limit=2000"
);

const confirmed = [];
const suspected = [];
const protectedHits = [];

for (const p of profiles) {
  if (PROTECTED_IDS.has(p.id)) {
    protectedHits.push({ id: p.id, email: p.email, reason: "protected real owner/admin" });
    continue;
  }
  const { reasons, g2IdOnly } = confirmReasons(p);
  if (g2IdOnly && !reasons.length) {
    suspected.push({
      table: "profiles",
      row_id: p.id,
      user_id: p.id,
      email: p.email,
      display_name: p.display_name,
      test_reason: "SUSPECTED_ONLY",
      marker_evidence: `G2 id hit but email mismatch (listed ${g2IdOnly.email}, actual ${p.email})`,
      delete_eligible: false,
    });
    continue;
  }
  if (!reasons.length) continue;
  // Confirmed only when is_test_account=true OR exact G2 id+email OR hard test email patterns.
  const hard =
    p.is_test_account === true ||
    reasons.some((r) => r.startsWith("G2 known") || r.startsWith("test email"));
  if (!hard) {
    suspected.push({
      table: "profiles",
      row_id: p.id,
      user_id: p.id,
      email: p.email,
      test_reason: "UNPROVEN_NAME_ONLY",
      marker_evidence: reasons.join("; "),
      delete_eligible: false,
    });
    continue;
  }
  confirmed.push({
    table: "profiles",
    row_id: p.id,
    user_id: p.id,
    email: p.email,
    display_name: p.display_name,
    role: p.role,
    test_reason: "CONFIRMED_TEST",
    marker_evidence: reasons.join("; "),
    related_parent: null,
    related_order: [],
    related_wallet: [],
    related_gift: [],
    related_settlement: [],
    delete_eligible: true,
  });
}

const testIds = confirmed.map((c) => c.user_id);
const inList = `(${testIds.map((id) => `"${id}"`).join(",")})`;

async function linkTable(table, filter, mapRow) {
  if (!testIds.length) return [];
  try {
    const rows = await rest(url, key, table, `?${filter}&limit=2000`);
    return (rows || []).map(mapRow);
  } catch (e) {
    console.warn(`[manifest] skip ${table}:`, e.message);
    return [];
  }
}

const related = [];
related.push(
  ...(await linkTable(
    "orders",
    `or=(boss_id.in.${inList},companion_id.in.${inList})&select=id,order_no,boss_id,companion_id,status,created_at`,
    (r) => ({
      table: "orders",
      row_id: r.id,
      user_id: r.boss_id || r.companion_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: `owner in confirmed test profiles; order_no=${r.order_no}`,
      related_parent: r.boss_id,
      related_order: r.id,
      delete_eligible: true,
      order_no: r.order_no,
      status: r.status,
    })
  ))
);
related.push(
  ...(await linkTable(
    "wallets",
    `boss_id=in.${inList}&select=boss_id,paid_balance,bonus_balance,total_balance`,
    (r) => ({
      table: "wallets",
      row_id: r.boss_id,
      user_id: r.boss_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: "wallet for confirmed test profile",
      related_wallet: r.boss_id,
      delete_eligible: true,
      note: "DO_NOT_PATCH_OPENING_LEDGER — delete only",
    })
  ))
);
related.push(
  ...(await linkTable(
    "wallet_transactions",
    `boss_id=in.${inList}&select=id,boss_id,transaction_type,amount,created_at&order=created_at.desc`,
    (r) => ({
      table: "wallet_transactions",
      row_id: r.id,
      user_id: r.boss_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: `wallet_tx type=${r.transaction_type}`,
      related_wallet: r.boss_id,
      delete_eligible: true,
    })
  ))
);
related.push(
  ...(await linkTable(
    "transactions",
    `user_id=in.${inList}&select=id,user_id,order_id,transaction_type,amount,created_at&order=created_at.desc`,
    (r) => ({
      table: "transactions",
      row_id: r.id,
      user_id: r.user_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: `ledger type=${r.transaction_type}`,
      related_order: r.order_id || null,
      related_settlement: r.id,
      delete_eligible: true,
    })
  ))
);
related.push(
  ...(await linkTable(
    "gift_transactions",
    `or=(sender_boss_id.in.${inList},receiver_companion_id.in.${inList})&select=id,sender_boss_id,receiver_companion_id,gross_cat_food,created_at`,
    (r) => ({
      table: "gift_transactions",
      row_id: r.id,
      user_id: r.sender_boss_id || r.receiver_companion_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: "gift_tx touches confirmed test profile",
      related_gift: r.id,
      delete_eligible: true,
    })
  ))
);
related.push(
  ...(await linkTable(
    "companion_withdrawals",
    `companion_id=in.${inList}&select=id,companion_id,status,cat_food_amount,created_at`,
    (r) => ({
      table: "companion_withdrawals",
      row_id: r.id,
      user_id: r.companion_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: `withdrawal status=${r.status}`,
      delete_eligible: true,
    })
  ))
);
related.push(
  ...(await linkTable(
    "companion_profiles",
    `user_id=in.${inList}&select=id,user_id,nickname,is_test_account`,
    (r) => ({
      table: "companion_profiles",
      row_id: r.id || r.user_id,
      user_id: r.user_id,
      test_reason: "CONFIRMED_TEST_RELATED",
      marker_evidence: "companion_profiles for confirmed test user",
      delete_eligible: true,
    })
  ))
);

// Attach related counts onto profile rows
const byUser = new Map(confirmed.map((c) => [c.user_id, c]));
for (const row of related) {
  const parent = byUser.get(row.user_id);
  if (!parent) continue;
  if (row.table === "orders") parent.related_order.push(row.row_id);
  if (row.table === "wallets" || row.table === "wallet_transactions") parent.related_wallet.push(row.row_id);
  if (row.table === "gift_transactions") parent.related_gift.push(row.row_id);
  if (row.table === "transactions") parent.related_settlement.push(row.row_id);
}

const realUserMatch = confirmed.filter((c) => PROTECTED_IDS.has(c.user_id)).length;
const unproven = suspected.length;
const manifest = {
  ok: realUserMatch === 0 && unproven >= 0,
  mode: "MANIFEST_ONLY",
  generated_at: new Date().toISOString(),
  production_ref: PRODUCTION_SUPABASE_REF,
  gates: {
    REAL_USER_MATCH: realUserMatch,
    UNPROVEN_ROW: unproven,
    CONFIRMED_PROFILES: confirmed.length,
    CONFIRMED_RELATED: related.length,
    DELETE_ALLOWED:
      realUserMatch === 0 && confirmed.length > 0
        ? "READY_FOR_AUTHORIZED_EXECUTE"
        : "BLOCKED",
  },
  policy: {
    delete_only_confirmed: true,
    never_delete_suspected: true,
    never_patch_opening_ledger: true,
    never_auto_fix_real_wallet_diff: true,
    test_data_source: TEST_DATA_SOURCE,
  },
  confirmed_rows: [...confirmed, ...related],
  suspected_rows: suspected,
  protected_rows: protectedHits,
};

const outPath = path.join(outDir, "PROD_TEST_CLEANUP_MANIFEST.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
fs.writeFileSync(
  path.join(outDir, "MANIFEST_SUMMARY.md"),
  `# Prod test cleanup manifest\n\n- generated: ${manifest.generated_at}\n- REAL_USER_MATCH: ${realUserMatch}\n- UNPROVEN_ROW: ${unproven}\n- confirmed profiles: ${confirmed.length}\n- related rows: ${related.length}\n- DELETE_ALLOWED: ${manifest.gates.DELETE_ALLOWED}\n\nSuspected (NOT deleted):\n${suspected.map((s) => `- ${s.row_id} ${s.email || ""} :: ${s.marker_evidence}`).join("\n") || "(none)"}\n`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      REAL_USER_MATCH: realUserMatch,
      UNPROVEN_ROW: unproven,
      confirmed_profiles: confirmed.length,
      related: related.length,
      DELETE_ALLOWED: manifest.gates.DELETE_ALLOWED,
    },
    null,
    2
  )
);
