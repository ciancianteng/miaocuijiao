#!/usr/bin/env node
/**
 * Production READ-ONLY: companion_notification_emails / notices for MCJO000406–414.
 * No writes.
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
const ref = new URL(url).hostname.split(".")[0];
if (ref !== PRODUCTION_SUPABASE_REF) {
  console.error("REF_MISMATCH", ref);
  process.exit(2);
}
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

const orders = await rest(
  `/rest/v1/orders?or=(${NOS.map((n) => `order_no.eq.${n}`).join(",")})&select=id,order_no,status,companion_id,parent_order_id,order_type,created_at&order=created_at.asc`
);
const orderRows = Array.isArray(orders.rows) ? orders.rows : [];
const ids = orderRows.map((r) => r.id);

const out = {
  ok: true,
  mode: "READ_ONLY",
  generated_at: new Date().toISOString(),
  supabase_ref: ref,
  orders: orderRows,
  emails_by_order_no: null,
  emails_by_id: null,
  fallback_notices: null,
  window_sep23_24: null,
  otp_tables: {},
};

for (const cols of [
  "id,companion_id,order_id,order_no,notice_key,notification_key,email_status,mail_type,email,subject,detail,created_at,sent_at,retry_count",
  "id,companion_id,order_id,order_no,notice_key,email_status,mail_type,subject,detail,created_at",
  "id,notice_key,notification_key,email_status,subject,detail,created_at",
]) {
  const byNo = await rest(
    `/rest/v1/companion_notification_emails?or=(${NOS.map((n) => `order_no.eq.${n}`).join(",")})&select=${cols}&order=created_at.asc`
  );
  if (byNo.status === 200 && Array.isArray(byNo.rows)) {
    out.emails_by_order_no = { status: 200, cols, count: byNo.rows.length, rows: byNo.rows };
    break;
  }
  out.emails_by_order_no = { status: byNo.status, cols, sample: byNo.rows };
}

if (ids.length) {
  for (const cols of [
    "id,companion_id,order_id,order_no,notice_key,notification_key,email_status,mail_type,email,subject,detail,created_at,sent_at,retry_count",
    "id,order_id,order_no,notice_key,email_status,subject,detail,created_at",
  ]) {
    const byId = await rest(
      `/rest/v1/companion_notification_emails?or=(${ids.map((id) => `order_id.eq.${id}`).join(",")})&select=${cols}&order=created_at.asc`
    );
    if (byId.status === 200 && Array.isArray(byId.rows)) {
      out.emails_by_id = { status: 200, cols, count: byId.rows.length, rows: byId.rows };
      break;
    }
    out.emails_by_id = { status: byId.status, cols, sample: byId.rows };
  }

  const orKeys = ids
    .flatMap((id) => [`notice_key.ilike.${id}*`, `notice_key.ilike.mail:${id}*`])
    .join(",");
  const notices = await rest(
    `/rest/v1/companion_notifications?or=(${orKeys})&select=id,companion_id,notice_key,category,title,body,created_at,notification_type&order=created_at.asc&limit=100`
  );
  out.fallback_notices = {
    status: notices.status,
    count: Array.isArray(notices.rows) ? notices.rows.length : 0,
    rows: Array.isArray(notices.rows) ? notices.rows : notices.rows,
  };
}

const start = "2026-09-23T00:00:00Z";
const end = "2026-09-25T00:00:00Z";
for (const q of [
  `/rest/v1/companion_notification_emails?created_at=gte.${start}&created_at=lt.${end}&select=id,email_status,mail_type,order_no,created_at&order=created_at.desc&limit=500`,
  `/rest/v1/companion_notification_emails?created_at=gte.${start}&created_at=lt.${end}&select=id,email_status,created_at&limit=500`,
]) {
  const r = await rest(q);
  if (r.status === 200 && Array.isArray(r.rows)) {
    const byStatus = {};
    const byType = {};
    for (const row of r.rows) {
      byStatus[row.email_status || "?"] = (byStatus[row.email_status || "?"] || 0) + 1;
      byType[row.mail_type || "?"] = (byType[row.mail_type || "?"] || 0) + 1;
    }
    out.window_sep23_24 = {
      status: 200,
      count: r.rows.length,
      byStatus,
      byType,
      sample: r.rows.slice(0, 40),
    };
    break;
  }
  out.window_sep23_24 = { status: r.status, sample: r.rows };
}

// Prefer Prefer: count=exact for volume
const countRes = await fetch(
  `${url}/rest/v1/companion_notification_emails?created_at=gte.${start}&created_at=lt.${end}&select=id`,
  { headers: { ...h, Prefer: "count=exact", Range: "0-0" } }
);
out.window_sep23_24_exact_count = {
  status: countRes.status,
  contentRange: countRes.headers.get("content-range"),
};

for (const table of ["otp_challenges", "auth_otps", "forgot_otps", "platform_otps", "otp_store"]) {
  const r = await rest(`/rest/v1/${table}?select=id&limit=1`);
  out.otp_tables[table] = r.status;
}

const outPath = path.join(outDir, "AUDIT_RESEND_MCJO407_414.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      wrote: outPath,
      orders: orderRows.length,
      emails_by_no: out.emails_by_order_no?.count ?? out.emails_by_order_no?.status,
      emails_by_id: out.emails_by_id?.count ?? out.emails_by_id?.status,
      notices: out.fallback_notices?.count ?? out.fallback_notices?.status,
      window: out.window_sep23_24?.count,
      windowExact: out.window_sep23_24_exact_count,
      byStatus: out.window_sep23_24?.byStatus,
    },
    null,
    2
  )
);
