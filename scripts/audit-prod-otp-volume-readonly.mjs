#!/usr/bin/env node
/**
 * Production READ-ONLY: password_reset_requests (OTP) volume Sep 23-24 UTC.
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

async function exactCount(filter) {
  const r = await fetch(`${url}/rest/v1/password_reset_requests?${filter}&select=id`, {
    headers: { ...h, Prefer: "count=exact", Range: "0-0" },
  });
  return { status: r.status, contentRange: r.headers.get("content-range") };
}

const start = "2026-09-23T00:00:00Z";
const end = "2026-09-25T00:00:00Z";

const out = { ok: true, mode: "READ_ONLY", supabase_ref: ref, generated_at: new Date().toISOString() };

out.count_window = await exactCount(`created_at=gte.${start}&created_at=lt.${end}`);
out.count_today_utc_sep24 = await exactCount(`created_at=gte.2026-09-24T00:00:00Z&created_at=lt.2026-09-25T00:00:00Z`);
out.count_sep23 = await exactCount(`created_at=gte.2026-09-23T00:00:00Z&created_at=lt.2026-09-24T00:00:00Z`);

// Probe columns
for (const cols of [
  "id,account_key,role,kind,created_at,provider,mail_provider,purpose,status",
  "id,account_key,role,kind,created_at,provider,status",
  "id,account_key,role,kind,created_at",
  "id,email,role,created_at",
  "id,created_at",
]) {
  const r = await rest(
    `/rest/v1/password_reset_requests?created_at=gte.${start}&created_at=lt.${end}&select=${cols}&order=created_at.desc&limit=100`
  );
  if (r.status === 200 && Array.isArray(r.rows)) {
    out.sample = { cols, count: r.rows.length, rows: r.rows };
    const byKind = {};
    const byRole = {};
    const byAccount = {};
    for (const row of r.rows) {
      const k = row.kind || row.purpose || "?";
      const role = row.role || "?";
      const acc = String(row.account_key || row.email || "?").toLowerCase();
      byKind[k] = (byKind[k] || 0) + 1;
      byRole[role] = (byRole[role] || 0) + 1;
      byAccount[acc] = (byAccount[acc] || 0) + 1;
    }
    out.rollup_sample100 = {
      byKind,
      byRole,
      topAccounts: Object.entries(byAccount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([account, n]) => ({ account: account.replace(/(.{2}).+(@.+)/, "$1***$2"), n })),
    };
    break;
  }
  out.sample_attempt = { status: r.status, cols, sample: r.rows };
}

// Also email_log with correct filter - earlier sample returned 0 despite count 4
out.email_logs = await rest(
  `/rest/v1/companion_notifications?category=eq.email_log&created_at=gte.${start}&created_at=lt.${end}&select=id,companion_id,notice_key,title,body,created_at&order=created_at.asc&limit=50`
);
if (Array.isArray(out.email_logs.rows)) {
  out.email_logs_parsed = out.email_logs.rows.map((row) => {
    let meta = {};
    try {
      meta = JSON.parse(row.body || "{}");
    } catch {
      /* */
    }
    return {
      id: row.id,
      notice_key: row.notice_key,
      created_at: row.created_at,
      title: row.title,
      emailStatus: meta.emailStatus,
      mailType: meta.mailType,
      orderNo: meta.orderNo,
      detail: String(meta.detail || "").slice(0, 160),
    };
  });
}

const outPath = path.join(root, "artifacts/p0-multi-cs-confirm-notify/AUDIT_RESEND_OTP_VOLUME.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      wrote: outPath,
      count_window: out.count_window,
      count_sep23: out.count_sep23,
      count_sep24: out.count_today_utc_sep24,
      sample_status: out.sample?.cols || out.sample_attempt?.status,
      rollup: out.rollup_sample100,
      email_logs: out.email_logs_parsed?.length ?? out.email_logs?.status,
      email_logs_parsed: out.email_logs_parsed,
    },
    null,
    2
  )
);
