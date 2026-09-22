#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  let body;
  try {
    body = JSON.parse(t || "null");
  } catch {
    body = { raw: t.slice(0, 500) };
  }
  return { status: r.status, body };
}

async function fetchText(u) {
  const r = await fetch(u, { cache: "no-store" });
  return { status: r.status, text: await r.text() };
}

function findSha(html) {
  const patterns = [
    /data-commit=["']([a-f0-9]{7,40})["']/i,
    /"gitSha"\s*:\s*"([a-f0-9]{7,40})"/i,
    /"commitSha"\s*:\s*"([a-f0-9]{7,40})"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

const out = { mode: "READ_ONLY" };
const home = await fetchText("https://www.meowcuijiao.com/");
out.home_status = home.status;
out.home_sha = findSha(home.text);
const build = await fetchText("https://www.meowcuijiao.com/api/build-info");
out.build_info_status = build.status;
try {
  out.build_info = JSON.parse(build.text);
} catch {
  out.build_info_snip = build.text.slice(0, 300);
}
const ordersHtml = await fetchText("https://www.meowcuijiao.com/orders.html");
out.orders_has_isMultiChild = /isMultiChild/.test(ordersHtml.text);
out.orders_has_parentOrderId = /parentOrderId/.test(ordersHtml.text);
out.orders_has_multi_badge = /多人陪玩订单/.test(ordersHtml.text);
out.orders_has_confirm_ui = /等待确认|已确认|confirmQueue|⏱/.test(ordersHtml.text);
out.payment_confirm_status = (await fetchText("https://www.meowcuijiao.com/payment-confirm.html")).status;

const probes = {};
for (const sel of [
  "id,order_no,parent_order_id",
  "id,order_no,parent_order_id,paid_at",
  "id,order_no,parent_order_id,paid_cat_food",
]) {
  const r = await rest(`/rest/v1/orders?order_no=eq.MCJO000392&select=${encodeURIComponent(sel)}&limit=1`);
  probes[sel] = r.status === 200 ? { ok: true } : { ok: false, status: r.status, body: r.body };
}
out.column_probes = probes;
fs.mkdirSync(path.join(root, "artifacts/p0-multi-payment-fix"), { recursive: true });
fs.writeFileSync(path.join(root, "artifacts/p0-multi-payment-fix/01-prod-sha-schema.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
