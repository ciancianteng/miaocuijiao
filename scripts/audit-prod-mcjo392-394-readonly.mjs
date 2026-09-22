#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-payment-fix");
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
const url = env.SUPABASE_URL.replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (new URL(url).hostname.split(".")[0] !== PRODUCTION_SUPABASE_REF) process.exit(2);
const h = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
async function rest(q) {
  const r = await fetch(url + q, { headers: h });
  const t = await r.text();
  try {
    return { status: r.status, rows: JSON.parse(t || "[]") };
  } catch {
    return { status: r.status, rows: { raw: t.slice(0, 400) } };
  }
}

const cols =
  "id,order_no,order_type,parent_order_id,status,settlement_status,total_amount,unit_price,companion_id,boss_id,created_at,accepted_at,started_at,completed_at,assignment_type,note,description";
const byNo = {};
for (const no of ["MCJO000392", "MCJO000394"]) {
  const r = await rest(`/rest/v1/orders?order_no=eq.${no}&select=${cols}`);
  byNo[no] = Array.isArray(r.rows) ? r.rows[0] : r.rows;
}
const p = byNo.MCJO000392;
const c394 = byNo.MCJO000394;
let children = [];
if (p?.id) {
  const r = await rest(`/rest/v1/orders?parent_order_id=eq.${p.id}&select=${cols}&order=created_at.asc`);
  children = Array.isArray(r.rows) ? r.rows : [];
}
let parentOf394 = null;
if (c394?.parent_order_id) {
  const r = await rest(`/rest/v1/orders?id=eq.${c394.parent_order_id}&select=${cols}`);
  parentOf394 = Array.isArray(r.rows) ? r.rows[0] : null;
}
const companionIds = [...new Set([...children, c394].filter(Boolean).map((x) => x.companion_id).filter(Boolean))];
const companions = {};
for (const id of companionIds) {
  const pr = await rest(`/rest/v1/profiles?id=eq.${id}&select=id,display_name,email`);
  const cp = await rest(`/rest/v1/companion_profiles?user_id=eq.${id}&select=nickname&limit=1`);
  companions[id] = {
    profile: Array.isArray(pr.rows) ? pr.rows[0] : null,
    nickname: Array.isArray(cp.rows) ? cp.rows[0]?.nickname : null,
  };
}
const bossId = p?.boss_id || c394?.boss_id;
let wallet = [];
if (bossId) {
  const ids = [p?.id, c394?.id, ...children.map((c) => c.id)].filter(Boolean);
  const wt = await rest(
    `/rest/v1/wallet_transactions?boss_id=eq.${bossId}&select=id,direction,transaction_type,amount,related_order_id,idempotency_key,reason,created_at&order=created_at.desc&limit=50`
  );
  const all = Array.isArray(wt.rows) ? wt.rows : [];
  wallet = all.filter((t) => ids.includes(t.related_order_id));
}
const out = {
  mode: "READ_ONLY",
  byNo,
  children_of_392: children,
  parent_of_394: parentOf394,
  companions,
  wallet_related: wallet,
  analysis: {
    "392_is_parent": p?.order_type === "multi_group" && !p?.parent_order_id,
    "392_child_count": children.length,
    "394_is_child_of_392": c394?.parent_order_id === p?.id,
    why_zero_members_ui:
      "DB has children — UI 共0位 means frontend list missing parentOrderId join / children not in state.orders",
    why_394_top_level: "394 has parent_order_id — if shown top-level, UI filter failed (isMultiChild false)",
  },
};
fs.writeFileSync(path.join(outDir, "00-prod-mcjo392-394-readonly.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
