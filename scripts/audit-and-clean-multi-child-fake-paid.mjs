#!/usr/bin/env node
/**
 * Production / Staging READONLY audit + optional cleanup of child "fake paid" stamps.
 *
 * Default: readonly report.
 * Apply cleanup only when:
 *   APPLY=1 ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 * (or staging without those flags when TARGET=staging)
 *
 * Cleanup is surgical:
 * - Clear child payment_method (duitnow etc) that fakes independent Boss payment
 * - Clear child paid_cat_food (Boss charge belongs on parent)
 * - Does NOT delete orders / receipts / parent payment_transactions
 * - Deletes payment_transactions whose order_id is a multi child (if any)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = String(process.env.TARGET || "prod").toLowerCase();
const APPLY = String(process.env.APPLY || "") === "1";
const outDir = path.join(root, "artifacts/p0-multi-payment-once-70");
fs.mkdirSync(outDir, { recursive: true });

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (/\[SENSITIVE\]/i.test(v)) continue;
    o[m[1]] = v;
  }
  return o;
}

function loadEnv() {
  const merged = {};
  for (const p of [
    path.join(root, ".env.local"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    path.join(root, ".env.vercel.prod.pull.tmp"),
    path.join(root, ".env.vercel.staging.pull"),
  ]) {
    Object.assign(merged, parseEnv(p));
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
    ? env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY_STAGING || ""
    : env.PROD_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ""
);
if (!url || !key) {
  console.error("Missing Supabase URL/key for", TARGET);
  process.exit(1);
}
const ref = (() => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
})();
const expect = TARGET === "staging" ? STAGING_SUPABASE_REF : PRODUCTION_SUPABASE_REF;
if (ref !== expect) {
  console.error("Ref mismatch", { ref, expect, TARGET });
  process.exit(1);
}

async function sb(pathname, init = {}) {
  const r = await fetch(`${url}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: init.headers?.Prefer || "return=representation",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!r.ok) throw new Error(`${r.status} ${pathname} ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}

const BOSS_ID = "458ce9ad-3425-42b1-ab66-24bca342f971";
const children = await sb(
  `orders?boss_id=eq.${BOSS_ID}&parent_order_id=not.is.null&select=id,order_no,parent_order_id,total_amount,status,paid_at,paid_cat_food,description,created_at&order=created_at.desc&limit=200`
);
const parents = await sb(
  `orders?boss_id=eq.${BOSS_ID}&parent_order_id=is.null&order_type=eq.multi_group&select=id,order_no,total_amount,status,paid_at,paid_cat_food,created_at&order=created_at.desc&limit=100`
);

const childIds = (children || []).map((c) => c.id).filter(Boolean);
let childTx = [];
if (childIds.length) {
  // chunk
  for (let i = 0; i < childIds.length; i += 40) {
    const chunk = childIds.slice(i, i + 40);
    const rows = await sb(
      `payment_transactions?order_id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id,order_id,gross_amount,payment_status,payment_method,created_at`
    ).catch(() => []);
    childTx = childTx.concat(rows || []);
  }
}

const dirtyChildren = (children || []).filter(
  (c) =>
    Number(c.paid_cat_food) > 0 ||
    /付款方式[：:]/i.test(String(c.description || ""))
);

const report = {
  TARGET,
  ref,
  readonly: !APPLY,
  parents: parents?.length || 0,
  children: children?.length || 0,
  dirtyChildren: dirtyChildren.map((c) => ({
    order_no: c.order_no,
    id: c.id,
    parent_order_id: c.parent_order_id,
    amount: c.total_amount,
    paid_cat_food: c.paid_cat_food,
    hasPayMethodInDescription: /付款方式[：:]/i.test(String(c.description || "")),
    status: c.status,
  })),
  childPaymentTransactions: childTx,
  planned: {
    clearChildPaidCatFood: dirtyChildren.filter((c) => Number(c.paid_cat_food) > 0).length,
    stripPayMethodFromChildDescription: dirtyChildren.filter((c) =>
      /付款方式[：:]/i.test(String(c.description || ""))
    ).length,
    deleteChildPaymentTx: childTx.length,
  },
};

fs.writeFileSync(path.join(outDir, `AUDIT_${TARGET}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.planned, null, 2));
console.log("dirtyChildren", report.dirtyChildren.length, "childTx", childTx.length);

if (!APPLY) {
  console.log("READONLY — set APPLY=1 (+ prod dual flags) to clean");
  process.exit(0);
}

if (TARGET === "prod") {
  if (
    process.env.ALLOW_PROD_SUPABASE_WRITE !== "1" ||
    process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK"
  ) {
    console.error("Prod APPLY blocked: need ALLOW_PROD_SUPABASE_WRITE=1 and CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK");
    process.exit(1);
  }
}

const applied = { cleared: [], deletedTx: [] };
for (const c of dirtyChildren) {
  const patch = {};
  if (Number(c.paid_cat_food) > 0) patch.paid_cat_food = 0;
  if (/付款方式[：:]/i.test(String(c.description || ""))) {
    patch.description = String(c.description || "")
      .split(/\r?\n/)
      .filter((line) => !/^\s*付款方式[：:]/i.test(line))
      .join("\n");
  }
  if (!Object.keys(patch).length) continue;
  await sb(`orders?id=eq.${encodeURIComponent(c.id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  applied.cleared.push({ order_no: c.order_no, id: c.id, patch });
}
for (const tx of childTx) {
  await sb(`payment_transactions?id=eq.${encodeURIComponent(tx.id)}`, { method: "DELETE" });
  applied.deletedTx.push(tx);
}
fs.writeFileSync(path.join(outDir, `APPLY_${TARGET}.json`), JSON.stringify(applied, null, 2));
console.log("APPLIED", applied.cleared.length, "clears,", applied.deletedTx.length, "tx deletes");
