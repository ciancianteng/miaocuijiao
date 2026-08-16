#!/usr/bin/env node
/**
 * P0: companion register must heal Auth-only orphan users (no profiles row)
 * instead of returning opaque 「操作失败，请稍后重试。」
 *
 * Staging only (OTP devCode). Does not touch Production.
 */
import { createHash, randomBytes } from "node:crypto";

const BASE = String(
  process.env.PREVIEW_URL ||
    process.env.MCJ_STAGING_URL ||
    process.argv[2] ||
    "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ANON = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function sb(method, path, body, key = SERVICE) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(typeof data === "object" ? data?.message || JSON.stringify(data) : String(data));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function api(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log("BASE", BASE);
  assert(SUPABASE_URL && SERVICE, "Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (staging)");
  assert(!/jqfaknpmcnqwqvatrwgo/i.test(SUPABASE_URL), "Refusing Production Supabase for this E2E");

  const stamp = Date.now().toString(36);
  const email = `e2e-orphan-reg-${stamp}@example.com`;
  const password = `Orphan${stamp}9a`;
  const nickname = `Orphan${stamp.slice(-4)}`;

  console.log("1) create Auth-only orphan", email);
  const created = await sb("POST", "/auth/v1/admin/users", {
    email,
    password: `Temp${stamp}9a`,
    email_confirm: true,
    user_metadata: { display_name: "orphan-temp", roles: ["companion"] },
    app_metadata: { roles: ["companion"] },
  });
  const userId = created?.id || created?.user?.id;
  assert(userId, "Auth create returned no id");

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await sb("DELETE", `/rest/v1/companion_profiles?user_id=eq.${userId}`, null).catch(() => {});
    await sb("DELETE", `/rest/v1/profiles?id=eq.${userId}`, null).catch(() => {});
    await sb("DELETE", `/auth/v1/admin/users/${userId}`, null).catch(() => {});
  };

  try {
    const profiles = await sb(
      "GET",
      `/rest/v1/profiles?id=eq.${userId}&select=id&limit=1`,
      null
    );
    assert(!profiles?.length, "Expected no profiles row for orphan");

    console.log("2) send + verify register OTP");
    const sent = await api("/api/auth", { action: "send_register_otp", email, role: "companion" });
    assert(sent.data?.ok, `send_register_otp failed: ${JSON.stringify(sent.data)}`);
    const code = sent.data.devCode;
    assert(code, "Staging must return devCode for @example.com");
    const verified = await api("/api/auth", {
      action: "verify_register_otp",
      email,
      code,
      role: "companion",
    });
    assert(verified.data?.registerToken, `verify failed: ${JSON.stringify(verified.data)}`);

    console.log("3) register (must heal orphan, not 操作失败)");
    const reg = await api("/api/companion", {
      action: "register",
      email,
      account: email,
      password,
      confirmPassword: password,
      nickname,
      registerToken: verified.data.registerToken,
      remember: true,
    });
    console.log("register", reg.status, reg.data?.message, reg.data?.healedOrphanProfile);
    assert(reg.status === 200 && reg.data?.ok, `register failed: ${JSON.stringify(reg.data)}`);
    assert(!/操作失败/.test(String(reg.data?.message || "")), "opaque 操作失败 still returned");
    assert(reg.data?.session?.accessToken || reg.data?.session?.token, "missing session");
    assert(reg.data?.healedOrphanProfile === true, "expected healedOrphanProfile=true");

    const afterProfile = await sb("GET", `/rest/v1/profiles?id=eq.${userId}&select=id,email,role&limit=1`, null);
    assert(afterProfile?.[0]?.id === userId, "profiles row not created");
    const afterCp = await sb(
      "GET",
      `/rest/v1/companion_profiles?user_id=eq.${userId}&select=id,application_status&limit=1`,
      null
    );
    assert(afterCp?.[0]?.id, "companion_profiles row not created");

    console.log("PASS orphan Auth register heal");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error("FAIL", err?.message || err);
  process.exit(1);
});
