#!/usr/bin/env node
/**
 * READONLY audit: boss 1717 / MCJ00015 multi-order tree + GMV impact.
 * Never INSERT/UPDATE/DELETE. Defaults to Production credentials from sibling .env.local
 * when TARGET=prod; use TARGET=staging + staging env for staging.
 *
 * node scripts/audit-boss-1717-multi-orders-readonly.mjs
 * TARGET=staging node scripts/audit-boss-1717-multi-orders-readonly.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_REF,
  STAGING_SUPABASE_REF,
} from "./lib/prod-guard.mjs";
import {
  buildDashboardStats,
  countsAsRevenue,
  isBusinessOrderRoot,
} from "../server/api/admin/dashboard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-gmv-blocker");
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function loadEnv() {
  const candidates = [
    path.join(root, ".env.local"),
    path.join(root, "../meow-cuijiao-homepage/.env.local"),
    path.join(root, "../meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local"),
    path.join(root, ".env.staging.local"),
    path.join(root, ".env.vercel.staging.pull"),
    path.join(root, ".env.vercel.staging.resolve"),
  ];
  let merged = {};
  for (const p of candidates) {
    const parsed = parseEnv(p);
    // Prefer non-redacted values
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || /\[SENSITIVE\]/i.test(v)) continue;
      merged[k] = v;
    }
  }
  return merged;
}

const env = loadEnv();
let url = String(
  TARGET === "staging"
    ? env.STAGING_SUPABASE_URL ||
        env.SUPABASE_URL_STAGING ||
        process.env.STAGING_SUPABASE_URL ||
        ""
    : env.PROD_SUPABASE_URL || env.SUPABASE_URL || ""
).replace(/\/$/, "");
let key = String(
  TARGET === "staging"
    ? env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
        env.SUPABASE_SERVICE_ROLE_KEY_STAGING ||
        process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
        ""
    : env.PROD_SUPABASE_SERVICE_ROLE_KEY ||
        env.SUPABASE_SERVICE_ROLE_KEY ||
        ""
);

// Staging pull files often use SUPABASE_* pointing at staging
if (TARGET === "staging" && !url) {
  url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
}

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SERVICE_ROLE_KEY for TARGET=" + TARGET);
  process.exit(1);
}

const ref = new URL(url).hostname.split(".")[0];
const expect =
  TARGET === "staging" ? STAGING_SUPABASE_REF : PRODUCTION_SUPABASE_REF;
if (ref !== expect) {
  console.error(
    JSON.stringify({
      error: "REF_MISMATCH",
      TARGET,
      ref,
      expect,
      urlHost: new URL(url).hostname,
    })
  );
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
};

async function rest(table, query) {
  const res = await fetch(`${url}/rest/v1/${table}${query}`, { headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok)
    throw new Error(`${table} ${res.status} ${String(text).slice(0, 300)}`);
  return Array.isArray(body) ? body : body;
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function classify(row, byId) {
  const id = row.id;
  const pid = row.parent_order_id;
  if (pid) {
    const parent = byId.get(pid);
    if (parent) return "VALID_CHILD";
    return "ORPHAN_CHILD";
  }
  const t = String(row.order_type || "").toLowerCase();
  if (t === "multi_group") return "VALID_PARENT";
  if (String(row.status || "") === "cancelled") return "CANCELLED";
  return "STANDALONE_OR_PARENT";
}

const profile = (
  await rest(
    "profiles",
    `?or=(id.eq.${BOSS_ID},boss_uid.eq.${BOSS_UID},display_name.eq.1717)&select=id,boss_uid,display_name,email,role,is_test_account&limit=5`
  )
)[0];

if (!profile) {
  console.error("Boss profile not found");
  process.exit(1);
}

const bossId = profile.id;
const selectCols =
  "id,order_no,parent_order_id,order_type,boss_id,companion_id,total_amount,unit_price,hours,status,created_at,accepted_at,started_at,completed_at,cancelled_at,idempotency_key,title,note,description";

let orders = await rest(
  "orders",
  `?boss_id=eq.${encodeURIComponent(bossId)}&select=${selectCols}&order=created_at.desc&limit=500`
);

const byId = new Map(orders.map((o) => [o.id, o]));
const childrenByParent = new Map();
for (const o of orders) {
  if (!o.parent_order_id) continue;
  if (!childrenByParent.has(o.parent_order_id))
    childrenByParent.set(o.parent_order_id, []);
  childrenByParent.get(o.parent_order_id).push(o);
}

const classified = orders.map((o) => ({
  ...o,
  tag: classify(o, byId),
  countsAsRevenue: isBusinessOrderRoot(o) && countsAsRevenue(o),
  amount: money(o.total_amount),
}));

const roots = classified.filter((o) => !o.parent_order_id);
const children = classified.filter((o) => o.parent_order_id);
const orphanChildren = classified.filter((o) => o.tag === "ORPHAN_CHILD");
const multiParents = classified.filter(
  (o) =>
    !o.parent_order_id && String(o.order_type || "").toLowerCase() === "multi_group"
);

// Detect duplicate parents: same companion set + similar amount within 10 min OR same idempotency prefix
const duplicateSuspects = [];
for (let i = 0; i < multiParents.length; i++) {
  for (let j = i + 1; j < multiParents.length; j++) {
    const a = multiParents[i];
    const b = multiParents[j];
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (Math.abs(ta - tb) > 15 * 60 * 1000) continue;
    if (money(a.total_amount) === money(b.total_amount) && money(a.total_amount) > 0) {
      duplicateSuspects.push({
        a: a.order_no,
        b: b.order_no,
        amount: money(a.total_amount),
        deltaSec: Math.round(Math.abs(ta - tb) / 1000),
        aId: a.id,
        bId: b.id,
      });
    }
  }
}

// GMV as dashboard would compute (this boss only subset vs full)
const profiles = await rest(
  "profiles",
  `?select=id,role,email,display_name,status,is_test_account,boss_uid&limit=8000`
).catch(() => [profile]);

const allOrdersForStats = await rest(
  "orders",
  `?select=id,status,total_amount,created_at,boss_id,companion_id,parent_order_id,order_type&order=created_at.desc&limit=5000`
).catch(() => orders);

const dash = buildDashboardStats({
  profiles,
  orders: allOrdersForStats,
  withdrawals: [],
  companionProfiles: [],
});

const bossRevenueRoots = classified.filter((o) => o.countsAsRevenue);
const bossChildIfCountedWrong = children.filter((o) => countsAsRevenue(o));
const wrongSum =
  bossRevenueRoots.reduce((s, o) => s + o.amount, 0) +
  bossChildIfCountedWrong.reduce((s, o) => s + o.amount, 0);
const correctSum = bossRevenueRoots.reduce((s, o) => s + o.amount, 0);

const trees = multiParents.map((p) => {
  const kids = (childrenByParent.get(p.id) || []).map((c) => ({
    id: c.id,
    order_no: c.order_no,
    companion_id: c.companion_id,
    amount: money(c.total_amount),
    status: c.status,
    created_at: c.created_at,
    idempotency_key: c.idempotency_key || null,
  }));
  return {
    parent: {
      id: p.id,
      order_no: p.order_no,
      amount: money(p.total_amount),
      status: p.status,
      payment_method: p.payment_method,
      created_at: p.created_at,
      paid_at: p.paid_at,
      idempotency_key: p.idempotency_key || null,
      countsAsRevenue: p.countsAsRevenue,
    },
    children: kids,
    childSum: kids.reduce((s, k) => s + k.amount, 0),
    structureOk:
      kids.length >= 1 &&
      Math.abs(kids.reduce((s, k) => s + k.amount, 0) - money(p.total_amount)) <
        0.02,
  };
});

// Recent 48h focus
const cutoff = Date.now() - 48 * 3600 * 1000;
const recent = classified.filter(
  (o) => new Date(o.created_at).getTime() >= cutoff
);

const report = {
  TARGET,
  ref,
  readonly: true,
  profile: {
    id: profile.id,
    boss_uid: profile.boss_uid,
    public_id: profile.public_id,
    display_name: profile.display_name,
    email: profile.email,
  },
  totals: {
    orderRows: orders.length,
    roots: roots.length,
    children: children.length,
    multiParents: multiParents.length,
    orphanChildren: orphanChildren.length,
    bossRevenueRootSum: correctSum,
    ifChildrenAlsoCounted: wrongSum,
    doubleCountDelta: Math.round((wrongSum - correctSum) * 100) / 100,
  },
  dashboardGlobal: dash.stats,
  dashboardFilter: dash.filter,
  duplicateSuspects,
  recent48h: recent.map((o) => ({
    order_no: o.order_no,
    id: o.id,
    parent_order_id: o.parent_order_id,
    order_type: o.order_type,
    amount: o.amount,
    status: o.status,
    tag: o.tag,
    countsAsRevenue: o.countsAsRevenue,
    created_at: o.created_at,
    idempotency_key: o.idempotency_key || null,
  })),
  trees,
  dryRunTags: classified.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    tag: o.tag,
    parent_order_id: o.parent_order_id,
    amount: o.amount,
    status: o.status,
    proposedAction:
      o.tag === "ORPHAN_CHILD"
        ? "INVESTIGATE_LINK_OR_MARK_TEST"
        : o.tag === "VALID_CHILD"
          ? "KEEP_CHILD_NO_GMV"
          : o.tag === "VALID_PARENT"
            ? "KEEP_PARENT_GMV_ONCE"
            : String(o.status) === "cancelled"
              ? "CANCELLED_EXCLUDE_GMV"
              : "KEEP_STANDALONE",
  })),
};

fs.writeFileSync(
  path.join(outDir, `AUDIT_${TARGET}_boss1717.json`),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
