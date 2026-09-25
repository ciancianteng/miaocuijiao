#!/usr/bin/env node
/**
 * Production READ-ONLY: fallback email_log notices + OTP-related rows around Sep 23-24.
 */
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
const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = new URL(url).hostname.split(".")[0];
if (ref !== PRODUCTION_SUPABASE_REF) process.exit(2);
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

async function exactCount(table, filter) {
  const r = await fetch(`${url}/rest/v1/${table}?${filter}&select=id`, {
    headers: { ...h, Prefer: "count=exact", Range: "0-0" },
  });
  return { status: r.status, contentRange: r.headers.get("content-range") };
}

const start = "2026-09-23T00:00:00Z";
const end = "2026-09-25T00:00:00Z";
const NOS = ["MCJO000406","MCJO000407","MCJO000408","MCJO000409","MCJO000410","MCJO000411","MCJO000412","MCJO000413","MCJO000414"];

const out = { ok: true, mode: "READ_ONLY", supabase_ref: ref, generated_at: new Date().toISOString() };

out.email_log_window = await rest(
  `/rest/v1/companion_notifications?category=eq.email_log&created_at=gte.${start}&created_at=lt.${end}&select=id,companion_id,notice_key,title,body,created_at,notification_type&order=created_at.desc&limit=200`
);
out.email_log_count = await exactCount(
  "companion_notifications",
  `category=eq.email_log&created_at=gte.${start}&created_at=lt.${end}`
);

// Parse body JSON for status sent vs failed
const rows = Array.isArray(out.email_log_window.rows) ? out.email_log_window.rows : [];
const byStatus = {};
const byType = {};
const related = [];
for (const row of rows) {
  let meta = {};
  try {
    meta = JSON.parse(row.body || "{}");
  } catch {
    meta = {};
  }
  const st = meta.emailStatus || "?";
  byStatus[st] = (byStatus[st] || 0) + 1;
  byType[meta.mailType || "?"] = (byType[meta.mailType || "?"] || 0) + 1;
  const blob = `${row.notice_key || ""} ${row.title || ""} ${row.body || ""}`;
  if (NOS.some((n) => blob.includes(n)) || NOS.some((n) => String(meta.orderNo || "").includes(n))) {
    related.push({
      id: row.id,
      notice_key: row.notice_key,
      title: row.title,
      created_at: row.created_at,
      emailStatus: st,
      mailType: meta.mailType,
      orderNo: meta.orderNo,
      orderId: meta.orderId,
      detail: String(meta.detail || "").slice(0, 120),
    });
  }
}
out.email_log_summary = {
  sampled: rows.length,
  byStatus,
  byType,
  related_to_mcjo406_414: related,
};

// order_assigned notices for those order ids (inbox, not necessarily email)
const orders = await rest(
  `/rest/v1/orders?or=(${NOS.map((n) => `order_no.eq.${n}`).join(",")})&select=id,order_no`
);
const ids = Array.isArray(orders.rows) ? orders.rows.map((r) => r.id) : [];
out.orders = orders.rows;
if (ids.length) {
  const orKeys = ids.flatMap((id) => [`notice_key.ilike.${id}*`, `notice_key.ilike.mail:${id}*`]).join(",");
  out.order_notices = await rest(
    `/rest/v1/companion_notifications?or=(${orKeys})&select=id,companion_id,notice_key,category,title,created_at,notification_type&order=created_at.asc&limit=100`
  );
}

// Probe OTP / mail related tables
out.table_probes = {};
for (const table of [
  "companion_notification_emails",
  "mcj_otps",
  "platform_otps",
  "auth_otp_codes",
  "otp_codes",
  "email_send_logs",
  "mail_logs",
  "system_settings",
]) {
  const r = await rest(`/rest/v1/${table}?select=*&limit=1`);
  out.table_probes[table] = r.status;
}

// Try list tables via rpc or information - skip if not allowed
const outPath = path.join(root, "artifacts/p0-multi-cs-confirm-notify/AUDIT_RESEND_FALLBACK_LOGS.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      wrote: outPath,
      email_log_count: out.email_log_count,
      sampled: rows.length,
      byStatus,
      byType,
      related: related.length,
      order_notices: out.order_notices?.status,
      order_notice_count: Array.isArray(out.order_notices?.rows) ? out.order_notices.rows.length : null,
      table_probes: out.table_probes,
    },
    null,
    2
  )
);
