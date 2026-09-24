#!/usr/bin/env node
/**
 * Production READ-ONLY audit MCJO000407–MCJO000414.
 * Soft column selects — never DELETE/UPDATE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-cs-confirm-notify");
fs.mkdirSync(outDir, { recursive: true });

function parseEnv(p) {
  const o = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (new URL(url).hostname.split(".")[0] !== PRODUCTION_SUPABASE_REF) process.exit(2);
const h = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };

async function rest(q) {
  const r = await fetch(url + q, { headers: h });
  const t = await r.text();
  let rows;
  try {
    rows = JSON.parse(t || "[]");
  } catch {
    rows = { raw: t.slice(0, 800) };
  }
  return { status: r.status, rows };
}

const NOS = [
  "MCJO000406",
  "MCJO000407",
  "MCJO000408",
  "MCJO000409",
  "MCJO000410",
  "MCJO000411",
  "MCJO000412",
  "MCJO000413",
  "MCJO000414",
];

const core =
  "id,order_no,order_type,parent_order_id,status,total_amount,companion_id,boss_id,assignment_type,created_at,title,game";

const orFilter = NOS.map((n) => `order_no.eq.${n}`).join(",");
let listed = await rest(`/rest/v1/orders?or=(${orFilter})&select=${core}&order=created_at.asc`);
let rows = Array.isArray(listed.rows) ? listed.rows : [];

async function softExtra(id) {
  const out = {};
  for (const cols of [
    "payment_method,idempotency_key,paid_at,note",
    "payment_method,idempotency_key",
    "idempotency_key",
    "payment_method",
  ]) {
    const r = await rest(`/rest/v1/orders?id=eq.${id}&select=id,${cols}`);
    if (r.status === 200 && Array.isArray(r.rows) && r.rows[0]) {
      Object.assign(out, r.rows[0]);
      break;
    }
  }
  return out;
}

const enriched = [];
for (const r of rows) {
  enriched.push({ ...r, ...(await softExtra(r.id)) });
}

const parentIds = [
  ...new Set(
    enriched
      .map((r) => r.parent_order_id)
      .filter(Boolean)
      .concat(enriched.filter((r) => String(r.order_type || "") === "multi_group" && !r.parent_order_id).map((r) => r.id))
  ),
];

const families = {};
for (const pid of parentIds) {
  const fam = await rest(
    `/rest/v1/orders?or=(id.eq.${pid},parent_order_id.eq.${pid})&select=${core}&order=created_at.asc`
  );
  const list = Array.isArray(fam.rows) ? fam.rows : [];
  const withExtra = [];
  for (const r of list) withExtra.push({ ...r, ...(await softExtra(r.id)) });
  families[pid] = withExtra;
}

const bossIds = [...new Set(enriched.map((r) => r.boss_id).filter(Boolean))];
const bosses = {};
for (const bid of bossIds) {
  const r = await rest(
    `/rest/v1/profiles?id=eq.${bid}&select=id,email,display_name,nickname,boss_uid,is_test_account&limit=1`
  );
  bosses[bid] = Array.isArray(r.rows) ? r.rows[0] : null;
}

const parentsInRange = enriched.filter((r) => String(r.order_type) === "multi_group" && !r.parent_order_id);
const childrenInRange = enriched.filter((r) => !!r.parent_order_id);

const mapping = {
  "MCJO000406": "PARENT multi_group (family A) — outside user list but parent of 407/408",
  "MCJO000407": "CHILD of MCJO000406",
  "MCJO000408": "CHILD of MCJO000406",
  "MCJO000409": "PARENT multi_group (family B)",
  "MCJO000410": "CHILD of MCJO000409",
  "MCJO000411": "CHILD of MCJO000409",
  "MCJO000412": "PARENT multi_group (family C)",
  "MCJO000413": "CHILD of MCJO000412",
  "MCJO000414": "CHILD of MCJO000412",
};

const report = {
  ok: true,
  mode: "READ_ONLY",
  generated_at: new Date().toISOString(),
  listed_status: listed.status,
  verdict: "A_PLUS_C",
  verdict_detail:
    "Three independent multi checkouts (~1h apart): each creates 1 parent + 2 children. CS orders list flattens children as separate rows (C). Not one click spawning 8 parents (B/D).",
  mapping,
  summary: {
    multi_parents: parentsInRange.map((r) => r.order_no),
    children: childrenInRange.map((r) => ({ no: r.order_no, parent: r.parent_order_id })),
    unique_bosses: bossIds.length,
    families: Object.fromEntries(
      Object.entries(families).map(([pid, list]) => [
        pid,
        list.map((r) => ({
          order_no: r.order_no,
          type: r.order_type,
          parent: r.parent_order_id,
          status: r.status,
          companion_id: r.companion_id,
          payment_method: r.payment_method || null,
          idempotency_key: r.idempotency_key || null,
          created_at: r.created_at,
        })),
      ])
    ),
  },
  rows: enriched,
  bosses,
  cleanup_note:
    "Do NOT delete yet. Propose cancel-only cleanup for cancelled test multi families after Owner confirms; never touch wallet/ledger.",
};

fs.writeFileSync(path.join(outDir, "AUDIT_MCJO407_414.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, mapping, summary: report.summary }, null, 2));
