/**
 * Verify multi-role login + companion profile/media/verification/deposit on Preview.
 * Never prints secrets.
 *
 * Usage: node scripts/verify-preview-roles.mjs <preview-base-url>
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

const PREVIEW = (process.argv[2] || "").replace(/\/$/, "");
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.MCJ_TEST_BOSS_EMAIL || "boss@meow.test";
const COMP = process.env.MCJ_TEST_COMPANION_EMAIL || "companion@meow.test";
const CS = process.env.MCJ_TEST_CS_EMAIL || "service@meow.test";
const findings = [];

function note(ok, id, detail) {
  findings.push({ ok, id, detail: String(detail || "") });
  console.log(`${ok ? "PASS" : "FAIL"} | ${id} | ${detail}`);
}

if (!PREVIEW) {
  console.error("FAIL: pass Preview base URL");
  process.exit(1);
}
if (!url || !anon) {
  console.error("FAIL: missing SUPABASE_URL / anon key");
  process.exit(1);
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${PREVIEW}${path}`, {
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
    body = { raw: text.slice(0, 180) };
  }
  return { res, body };
}

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: svc,
      Authorization: `Bearer ${svc}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

// 1) logins
let bossAuth;
let csAuth;
let compAuth;
try {
  bossAuth = await login(BOSS);
  note(true, "boss-login", "ok");
} catch (e) {
  note(false, "boss-login", e.message);
}
try {
  csAuth = await login(CS);
  note(true, "cs-login", "ok");
} catch (e) {
  note(false, "cs-login", e.message);
}
try {
  compAuth = await login(COMP);
  note(true, "companion-login", "ok");
} catch (e) {
  note(false, "companion-login", e.message);
}

if (!compAuth?.access_token) {
  console.log(`\nSUMMARY fail=${findings.filter((f) => !f.ok).length}/${findings.length}`);
  process.exit(1);
}

const token = compAuth.access_token;
const uid = compAuth.user.id;

// 2) companion bootstrap / profile read
{
  const { res, body } = await api("/api/companion?action=bootstrap", token);
  note(res.ok && body.ok !== false, "companion-profile-read", `HTTP ${res.status}`);
}

// 3) profile submit (full required fields, in-range price)
{
  const boot = await api("/api/companion?action=bootstrap", token);
  const p = boot.body.data?.player || {};
  const raw = p.raw || {};
  const level = boot.body.data?.levelInfo || {};
  const minP = Number(level.minPrice ?? 20);
  const maxP = Number(level.maxPrice ?? 30);
  const maxPlus = !!level.maxPlus;
  let price = Number(level.price ?? p.rawPrice ?? p.price ?? 25);
  if (!Number.isFinite(price) || price < minP || (!maxPlus && price > maxP)) price = minP;
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({
      action: "update_profile",
      nickname: String(p.name || "TEST陪玩"),
      age: String(raw.age || 23),
      gender: String(raw.gender || "女"),
      region: String(raw.region || "马来西亚·吉隆坡"),
      contact_phone: String(raw.contact_phone || "012-3456789"),
      main_game: String(p.mainGame || raw.game || "Valorant"),
      game_id: String(p.gameId || raw.game_id || "CMP001"),
      rank: String(raw.game_rank || raw.rank || ""),
      position: String(raw.position || ""),
      bio: String(p.bio || "Preview验收"),
      price: String(price),
    }),
  });
  note(res.ok && body.ok !== false, "companion-profile-submit", `HTTP ${res.status} ${body.message || ""}`);
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// 4) avatar + gallery
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({ action: "upload_media", media_type: "avatar", data_url: tinyPng, filename: "preview-avatar.png" }),
  });
  note(res.ok && body.ok !== false && !!body.url, "upload-avatar", `HTTP ${res.status} ${body.message || ""}`);
}
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({ action: "upload_media", media_type: "gallery", data_url: tinyPng, filename: "preview-gal.png" }),
  });
  note(res.ok && body.ok !== false && !!body.url, "upload-gallery", `HTTP ${res.status} ${body.message || ""}`);
}

// 5) identity verification
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({
      action: "submit_verification",
      real_name: "Preview Test",
      identity_no: "A123456789",
      phone: "0123456789",
      bank_name: "Maybank",
      bank_account: "1234567890",
      tng_account: "0123456789",
    }),
  });
  note(res.ok && body.ok !== false, "identity-verification", `HTTP ${res.status} ${body.message || ""}`);
}

// 6) payment accounts readable
if (svc) {
  const { res, body } = await rest(`companion_payment_accounts?user_id=eq.${encodeURIComponent(uid)}&select=id,status&limit=5`);
  const n = Array.isArray(body) ? body.length : 0;
  note(res.ok && n >= 0, "payment-accounts", `HTTP ${res.status} rows=${n}`);
} else {
  note(false, "payment-accounts", "missing service role key");
}

// 7) deposit
{
  const { res, body } = await api("/api/companion", token, {
    method: "POST",
    body: JSON.stringify({
      action: "submit_deposit_proof",
      paid_amount: 100,
      payment_method: "TNG",
      proof_url: tinyPng,
      remark: "preview verify",
    }),
  });
  note(res.ok && body.ok !== false, "deposit-submit", `HTTP ${res.status} ${body.message || ""}`);
}

// bonus: CS bootstrap reachable
if (csAuth?.access_token) {
  const { res } = await api("/api/customer-service?action=bootstrap", csAuth.access_token);
  note(res.ok, "cs-bootstrap", `HTTP ${res.status}`);
}

const failed = findings.filter((f) => !f.ok);
console.log(`\nSUMMARY fail=${failed.length}/${findings.length} preview=${PREVIEW}`);
process.exit(failed.length ? 1 : 0);
