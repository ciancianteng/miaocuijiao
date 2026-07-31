/**
 * Post-migration companion verification against Preview or API host.
 * Never prints secrets.
 * Usage: node scripts/verify-companion-after-migration.mjs [preview-base-url]
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const BASE = (process.argv[2] || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.MCJ_TEST_COMPANION_EMAIL || "companion@meow.test";
const findings = [];

function note(ok, id, detail) {
  findings.push({ ok, id, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} | ${detail}`);
}

if (!url || !anon || !key) {
  console.error("FAIL: missing supabase env");
  process.exit(1);
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed HTTP ${res.status}`);
  return body;
}

async function api(path, token, init = {}) {
  const target = BASE.startsWith("http") && !BASE.includes("supabase.co") ? `${BASE}${path}` : `${url}${path}`;
  // For companion API always hit Preview if provided as first arg and looks like vercel.
  const endpoint =
    process.argv[2] && /vercel\.app$/i.test(new URL(process.argv[2]).host)
      ? `${String(process.argv[2]).replace(/\/$/, "")}${path}`
      : null;
  const res = await fetch(endpoint || `${String(process.argv[2] || "").replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 160) };
  }
  return { res, body };
}

async function restOk(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  return res.ok;
}

const preview = (process.argv[2] || "").replace(/\/$/, "");
if (!preview) {
  console.error("FAIL: pass Preview base URL");
  process.exit(1);
}

note(await restOk("companion_media"), "table-companion_media", "rest");
note(await restOk("companion_identity_verifications"), "table-identity", "rest");
note(await restOk("companion_payment_accounts"), "table-payment", "rest");
note(await restOk("companion_deposits"), "table-deposits", "rest");

const auth = await login(COMP);
note(!!auth.access_token, "companion-login", "token");
const token = auth.access_token;

{
  const { res, body } = await api("/api/companion?action=bootstrap", token);
  note(res.ok && body.ok !== false, "profile-bootstrap", `HTTP ${res.status}`);
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({ action: "upload_media", media_type: "avatar", data_url: tinyPng, filename: "mig-avatar.png" }),
  });
  note(res.ok && body.ok !== false, "upload-avatar", `HTTP ${res.status} ${body.message || ""}`);
}
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({ action: "upload_media", media_type: "gallery", data_url: tinyPng, filename: "mig-gal.png" }),
  });
  note(res.ok && body.ok !== false, "upload-gallery", `HTTP ${res.status} ${body.message || ""}`);
}
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({
      action: "submit_verification",
      real_name: "Migration Test",
      identity_no: "A123456789",
      phone: "0123456789",
      bank_name: "Maybank",
      bank_account: "1234567890",
    }),
  });
  note(res.ok && body.ok !== false, "identity-submit", `HTTP ${res.status} ${body.message || ""}`);
}
{
  // payment account is usually part of submit_verification; also probe payment table write via same flow result
  const pay = await fetch(`${url}/rest/v1/companion_payment_accounts?user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,status&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const rows = await pay.json().catch(() => []);
  note(pay.ok, "payment-account-table", `HTTP ${pay.status} rows=${Array.isArray(rows) ? rows.length : 0}`);
}
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({
      action: "submit_deposit",
      paid_amount: 100,
      payment_method: "TNG",
      proof_url: tinyPng,
      remark: "migration verify",
    }),
  });
  note(res.ok && body.ok !== false, "deposit-submit", `HTTP ${res.status} ${body.message || ""}`);
}

const failed = findings.filter((f) => !f.ok);
console.log(`\nSUMMARY fail=${failed.length}/${findings.length}`);
process.exit(failed.length ? 1 : 0);
