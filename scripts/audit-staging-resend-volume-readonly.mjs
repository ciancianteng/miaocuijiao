#!/usr/bin/env node
/**
 * Staging READ-ONLY: OTP + email_log volume (does Staging burn shared Resend?).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGING_SUPABASE_REF, assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

assertSmokeTargetAllowed({
  baseUrl: "https://meow-cuijiao-homepage-staging.vercel.app",
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
  label: "audit-staging-resend-volume",
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return null;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

// Prefer staging service role from sibling or vercel pull files that may have non-secret supabase url
const candidates = [
  path.join(root, ".env.vercel.staging.resolve"),
  path.join(root, ".env.vercel.staging.pull"),
  path.join(root, ".env.staging.local"),
  path.join(root, "../meow-cuijiao-homepage/.env.staging.local"),
  path.join(root, "../meow-cuijiao-homepage/.env.local"),
];

let env = null;
let envPath = "";
for (const p of candidates) {
  const e = parseEnv(p);
  if (!e) continue;
  const u = String(e.SUPABASE_URL || "");
  if (u.includes(STAGING_SUPABASE_REF) && e.SUPABASE_SERVICE_ROLE_KEY && e.SUPABASE_SERVICE_ROLE_KEY !== "[SENSITIVE]") {
    env = e;
    envPath = p;
    break;
  }
}

if (!env) {
  // Try vercel env run isn't available here; look for any staging key
  console.log(JSON.stringify({ ok: false, reason: "no_staging_service_role_in_local_env", tried: candidates.map((c) => path.basename(c)) }, null, 2));
  process.exit(0);
}

const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const ref = new URL(url).hostname.split(".")[0];
if (ref !== STAGING_SUPABASE_REF) {
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

async function exactCount(table, filter) {
  const r = await fetch(`${url}/rest/v1/${table}?${filter}&select=id`, {
    headers: { ...h, Prefer: "count=exact", Range: "0-0" },
  });
  return { status: r.status, contentRange: r.headers.get("content-range") };
}

const start = "2026-09-23T00:00:00Z";
const end = "2026-09-25T00:00:00Z";

const out = {
  ok: true,
  mode: "READ_ONLY",
  envPath: path.basename(envPath),
  supabase_ref: ref,
  generated_at: new Date().toISOString(),
  otp_count: await exactCount("password_reset_requests", `created_at=gte.${start}&created_at=lt.${end}`),
  otp_sep23: await exactCount("password_reset_requests", `created_at=gte.2026-09-23T00:00:00Z&created_at=lt.2026-09-24T00:00:00Z`),
  otp_sep24: await exactCount("password_reset_requests", `created_at=gte.2026-09-24T00:00:00Z&created_at=lt.2026-09-25T00:00:00Z`),
  email_log_count: await exactCount("companion_notifications", `category=eq.email_log&created_at=gte.${start}&created_at=lt.${end}`),
  companion_notification_emails: await exactCount("companion_notification_emails", `created_at=gte.${start}&created_at=lt.${end}`),
};

for (const cols of [
  "id,account_key,role,kind,created_at",
  "id,created_at",
]) {
  const r = await rest(
    `/rest/v1/password_reset_requests?created_at=gte.${start}&created_at=lt.${end}&select=${cols}&order=created_at.desc&limit=80`
  );
  if (r.status === 200 && Array.isArray(r.rows)) {
    const byKind = {};
    const byRole = {};
    for (const row of r.rows) {
      byKind[row.kind || "?"] = (byKind[row.kind || "?"] || 0) + 1;
      byRole[row.role || "?"] = (byRole[row.role || "?"] || 0) + 1;
    }
    out.otp_sample = { cols, n: r.rows.length, byKind, byRole };
    break;
  }
}

const emailLogs = await rest(
  `/rest/v1/companion_notifications?category=eq.email_log&created_at=gte.${start}&created_at=lt.${end}&select=id,notice_key,title,body,created_at&order=created_at.desc&limit=50`
);
if (Array.isArray(emailLogs.rows)) {
  const byStatus = {};
  const byType = {};
  for (const row of emailLogs.rows) {
    let meta = {};
    try {
      meta = JSON.parse(row.body || "{}");
    } catch {
      /* */
    }
    byStatus[meta.emailStatus || "?"] = (byStatus[meta.emailStatus || "?"] || 0) + 1;
    byType[meta.mailType || "?"] = (byType[meta.mailType || "?"] || 0) + 1;
  }
  out.email_log_sample = { n: emailLogs.rows.length, byStatus, byType };
}

const outPath = path.join(root, "artifacts/p0-multi-cs-confirm-notify/AUDIT_RESEND_STAGING_VOLUME.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ wrote: outPath, ...out, otp_sample: out.otp_sample, email_log_sample: out.email_log_sample }, null, 2));
