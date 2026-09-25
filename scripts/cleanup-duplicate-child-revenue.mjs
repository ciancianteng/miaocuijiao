#!/usr/bin/env node
/**
 * Surgical finance cleanup: clear BUG-induced child paid stamps / orphan child TX.
 * Never deletes real parent orders. Dry-run by default; APPLY=1 to mutate.
 *
 * Staging-only unless emergency dual prod flags are set by a human.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnvFiles,
  assertSmokeTargetAllowed,
  STAGING_SUPABASE_REF,
} from "./lib/prod-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "artifacts", "p0-cs-approved-revenue-lock");
fs.mkdirSync(outDir, { recursive: true });

loadEnvFiles(root);
for (const name of [".env.vercel.staging.pull", ".env.staging.local"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || !value || /\[SENSITIVE\]/i.test(value)) continue;
    if (process.env[key] == null || /\[SENSITIVE\]/i.test(String(process.env[key] || ""))) {
      process.env[key] = value;
    }
  }
}

const APPLY = process.env.APPLY === "1";
const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !/^https:\/\//i.test(url) || !key) {
  console.error("Missing/invalid SUPABASE_URL or SERVICE_ROLE_KEY (need https://…supabase.co)");
  process.exit(1);
}

assertSmokeTargetAllowed({
  script: "cleanup-duplicate-child-revenue.mjs",
  base: process.env.SMOKE_BASE_URL || "https://meow-cuijiao-homepage-staging.vercel.app",
  supabaseUrl: url,
  requireStagingSupabase: !process.env.ALLOW_PROD_SUPABASE_WRITE,
});

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function rest(table, query = "", init = {}) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${table} ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const children = await rest(
  "orders",
  "?parent_order_id=not.is.null&select=id,order_no,parent_order_id,status,total_amount,paid_at,paid_cat_food,created_at&or=(paid_cat_food.gt.0,paid_at.not.is.null)&limit=2000"
).catch(() => []);

const childIds = (children || []).map((c) => c.id).filter(Boolean);
let childTx = [];
if (childIds.length) {
  const chunk = childIds.slice(0, 80);
  childTx = await rest(
    "payment_transactions",
    `?order_id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id,order_id,gross_amount,payment_status,confirmed_at`
  ).catch(() => []);
}

const report = {
  at: new Date().toISOString(),
  apply: APPLY,
  stagingRef: STAGING_SUPABASE_REF,
  childPaidStampsFound: (children || []).length,
  childTxFound: (childTx || []).length,
  children: (children || []).map((c) => ({
    id: c.id,
    order_no: c.order_no,
    parent_order_id: c.parent_order_id,
    paid_cat_food: money(c.paid_cat_food),
    paid_at: c.paid_at || null,
    total_amount: money(c.total_amount),
  })),
  childTransactions: childTx || [],
  cleared: [],
  deletedTx: [],
};

if (APPLY) {
  for (const c of children || []) {
    try {
      const rows = await rest(`orders?id=eq.${encodeURIComponent(c.id)}`, "", {
        method: "PATCH",
        body: JSON.stringify({ paid_cat_food: 0, paid_at: null }),
      });
      report.cleared.push({ id: c.id, after: rows?.[0] || null });
    } catch (err) {
      if (!/paid_at/i.test(String(err.message || ""))) throw err;
      const rows = await rest(`orders?id=eq.${encodeURIComponent(c.id)}`, "", {
        method: "PATCH",
        body: JSON.stringify({ paid_cat_food: 0 }),
      });
      report.cleared.push({ id: c.id, after: rows?.[0] || null, soft: true });
    }
  }
  for (const tx of childTx || []) {
    await rest(`payment_transactions?id=eq.${encodeURIComponent(tx.id)}`, "", { method: "DELETE" });
    report.deletedTx.push(tx.id);
  }
}

fs.writeFileSync(path.join(outDir, APPLY ? "CLEANUP_APPLY.json" : "CLEANUP_DRY_RUN.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    { ok: true, apply: APPLY, childPaidStampsFound: report.childPaidStampsFound, childTxFound: report.childTxFound },
    null,
    2
  )
);
