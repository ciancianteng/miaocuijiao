#!/usr/bin/env node
/**
 * Production READ-ONLY: detect real-user wallet balance vs ledger DIFF.
 * NEVER auto-fix. Emits P0 REAL FINANCE DIFF report and exits non-zero when found.
 *
 * Excludes is_test_account / QA markers (§23–24).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { isTestAccountRecord } from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/prod-real-wallet-diff");
fs.mkdirSync(outDir, { recursive: true });

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

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
  const url = String(process.env.PROD_SUPABASE_URL || fileEnv.SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const key = String(
    process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || ""
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
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${table} ${res.status}`);
  return res.json();
}

const { url, key, ref } = resolveProd();
if (!url || !key || ref !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: Production credentials required");
  process.exit(2);
}

const wallets = await rest(
  url,
  key,
  "wallets",
  "?select=boss_id,paid_balance,bonus_balance,held_balance,total_balance&limit=2000"
);
const profiles = await rest(
  url,
  key,
  "profiles",
  "?select=id,email,display_name,is_test_account,role&limit=2000"
);
const byId = new Map(profiles.map((p) => [p.id, p]));

const diffs = [];
for (const w of wallets || []) {
  const p = byId.get(w.boss_id);
  if (!p) continue;
  if (isTestAccountRecord(p)) continue; // test wallets: delete, do not patch (§23)

  let txs = [];
  try {
    txs = await rest(
      url,
      key,
      "wallet_transactions",
      `?boss_id=eq.${encodeURIComponent(w.boss_id)}&select=id,transaction_type,amount,direction,balance_type,created_at&order=created_at.asc&limit=2000`
    );
  } catch {
    continue;
  }

  let expectedPaid = 0;
  let expectedBonus = 0;
  for (const t of txs || []) {
    const amt = money(t.amount);
    const dir = String(t.direction || "").toLowerCase();
    const signed = dir === "debit" || dir === "out" ? -amt : amt;
    if (String(t.balance_type || "") === "bonus") expectedBonus = money(expectedBonus + signed);
    else expectedPaid = money(expectedPaid + signed);
  }
  const actualPaid = money(w.paid_balance);
  const actualBonus = money(w.bonus_balance);
  const diffPaid = money(actualPaid - expectedPaid);
  const diffBonus = money(actualBonus - expectedBonus);
  if (Math.abs(diffPaid) > 0.009 || Math.abs(diffBonus) > 0.009) {
    diffs.push({
      severity: "P0_REAL_FINANCE_DIFF",
      user_id: w.boss_id,
      email: p.email,
      display_name: p.display_name,
      is_test_account: !!p.is_test_account,
      actual: { paid: actualPaid, bonus: actualBonus, total: money(w.total_balance) },
      expected: { paid: expectedPaid, bonus: expectedBonus },
      diff: { paid: diffPaid, bonus: diffBonus },
      related_transactions_sample: (txs || []).slice(-10).map((t) => ({
        id: t.id,
        type: t.transaction_type,
        amount: t.amount,
        direction: t.direction,
        balance_type: t.balance_type,
        created_at: t.created_at,
      })),
      action: "STOP — do not auto-fix; Owner decision required",
    });
  }
}

const report = {
  ok: diffs.length === 0,
  mode: "READ_ONLY",
  generated_at: new Date().toISOString(),
  production_ref: PRODUCTION_SUPABASE_REF,
  real_user_diffs: diffs.length,
  diffs,
  note: "Test wallets excluded. Never patch opening ledger for tests. Never auto-fix real diffs.",
};

fs.writeFileSync(path.join(outDir, "P0_REAL_FINANCE_DIFF.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(outDir, "REPORT.md"),
  `# P0 REAL FINANCE DIFF\n\n- generated: ${report.generated_at}\n- real_user_diffs: ${diffs.length}\n- ok: ${report.ok}\n\n${
    diffs.length
      ? diffs
          .map(
            (d) =>
              `## ${d.user_id}\n- email: ${d.email}\n- actual: ${JSON.stringify(d.actual)}\n- expected: ${JSON.stringify(d.expected)}\n- diff: ${JSON.stringify(d.diff)}\n`
          )
          .join("\n")
      : "No real-user wallet DIFF found.\n"
  }`
);

console.log(JSON.stringify({ ok: report.ok, real_user_diffs: diffs.length, out: outDir }, null, 2));
process.exit(diffs.length ? 1 : 0);
