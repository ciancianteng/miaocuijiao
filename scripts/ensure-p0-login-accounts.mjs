/**
 * Ensure P0 four-portal test accounts can login on Staging.
 * Resets password, creates missing profiles, re-enables disabled companions.
 * node scripts/ensure-p0-login-accounts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);

const URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const PASS = "McjTest@12345678";
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";

const TARGETS = [
  { email: "boss@meow.test", role: "boss", display: "P0 Boss" },
  { email: "boss.final.1785714993009@meow.test", role: "boss", display: "Boss Final" },
  { email: "service@meow.test", role: "customer_service", display: "P0 CS" },
  { email: "service.final.1785714993009@meow.test", role: "customer_service", display: "CS Final" },
  { email: "companion@meow.test", role: "companion", display: "P0 Companion" },
  { email: "companion.final.1785714993009@meow.test", role: "companion", display: "Companion Final" },
  { email: "companion.idcard.1785715257525@meow.test", role: "companion", display: "Companion IdCard" },
  { email: "admin@meow.test", role: "admin", display: "Admin" },
];

function svcHeaders(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function listUsersByEmail(email) {
  // Admin list is paginated; use filter via auth admin get by email is not direct — search profiles first
  const prof = await fetch(
    `${URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,email,role,status&limit=1`,
    { headers: svcHeaders() }
  ).then((r) => r.json());
  if (Array.isArray(prof) && prof[0]?.id) return { id: prof[0].id, profile: prof[0] };

  const listed = await fetch(`${URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: svcHeaders(),
  }).then((r) => r.json());
  const users = listed?.users || listed || [];
  const hit = (Array.isArray(users) ? users : []).find((u) => String(u.email || "").toLowerCase() === email.toLowerCase());
  return hit ? { id: hit.id, profile: null, auth: hit } : null;
}

async function ensureAuthUser(email) {
  const existing = await listUsersByEmail(email);
  if (existing?.id) {
    const r = await fetch(`${URL}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: svcHeaders(),
      body: JSON.stringify({ password: PASS, email_confirm: true, ban_duration: "none" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`reset ${email}: ${JSON.stringify(j).slice(0, 200)}`);
    return existing.id;
  }
  const created = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({
      email,
      password: PASS,
      email_confirm: true,
      user_metadata: { display_name: email.split("@")[0] },
    }),
  }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(`create ${email}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  });
  return created.id;
}

async function ensureProfile(id, { email, role, display }) {
  const rows = await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=id,role,status,email,boss_uid`, {
    headers: svcHeaders(),
  }).then((r) => r.json());
  if (Array.isArray(rows) && rows[0]) {
    await fetch(`${URL}/rest/v1/profiles?id=eq.${id}`, {
      method: "PATCH",
      headers: svcHeaders(),
      body: JSON.stringify({
        role,
        status: "active",
        email,
        display_name: rows[0].display_name || display,
      }),
    });
    return;
  }
  // Avoid boss_uid unique collisions on insert — let DB default / leave null then allocate
  const payload = {
    id,
    role,
    email,
    display_name: display,
    status: "active",
    created_at: new Date().toISOString(),
  };
  let r = await fetch(`${URL}/rest/v1/profiles`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    if (/boss_uid|23505/i.test(t)) {
      // Retry with explicit unique boss_uid for boss role
      const stamp = String(Date.now()).slice(-6);
      payload.boss_uid = role === "boss" ? `MCJ9${stamp}` : null;
      r = await fetch(`${URL}/rest/v1/profiles`, {
        method: "POST",
        headers: svcHeaders(),
        body: JSON.stringify(payload),
      });
    }
    if (!r.ok) {
      const t2 = await r.text();
      throw new Error(`profile ${email}: ${(t2 || t).slice(0, 240)}`);
    }
  }
}

async function ensureCompanionRow(userId, display) {
  const rows = await fetch(`${URL}/rest/v1/companion_profiles?user_id=eq.${userId}&select=id,application_status`, {
    headers: svcHeaders(),
  }).then((r) => r.json());
  const patch = {
    nickname: display,
    application_status: "approved",
    verification_status: "approved",
    deposit_status: "approved",
    allow_orders: true,
    online_status: "online",
    updated_at: new Date().toISOString(),
  };
  if (Array.isArray(rows) && rows[0]) {
    await fetch(`${URL}/rest/v1/companion_profiles?user_id=eq.${userId}`, {
      method: "PATCH",
      headers: svcHeaders(),
      body: JSON.stringify(patch),
    });
    return;
  }
  await fetch(`${URL}/rest/v1/companion_profiles`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({
      user_id: userId,
      ...patch,
      created_at: new Date().toISOString(),
    }),
  });
}

async function verifyLogin(email) {
  const r = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, account: email }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!(j.ok && (j.session?.accessToken || j.session?.token)), message: j.message || String(r.status) };
}

async function main() {
  console.log("URL", URL);
  for (const t of TARGETS) {
    try {
      const id = await ensureAuthUser(t.email);
      await ensureProfile(id, t);
      if (t.role === "companion") await ensureCompanionRow(id, t.display);
      const v = await verifyLogin(t.email);
      console.log(v.ok ? "LOGIN_OK" : "LOGIN_FAIL", t.email, v.message);
    } catch (e) {
      console.log("ERROR", t.email, e.message || e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
