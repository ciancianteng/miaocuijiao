#!/usr/bin/env node
/**
 * Provision Staging organic accounts via HTTP debug OTP (no service-role required).
 * Emails: *@mcj-staging-organic.invalid — is_test_account=false; Prod login blocked.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { STAGING_ORGANIC_SOURCE } from "../server/api/_test-accounts.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/go-live-organic");
fs.mkdirSync(outDir, { recursive: true });
const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.ORGANIC_PASS || "OrganicGoLive!Mcj2026";

assertSmokeTargetAllowed({
  script: "provision-staging-organic-accounts-http",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

async function api(pathname, token, body, extra = {}) {
  const res = await fetch(`${STG}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function loginOrResetBoss(email, displayName) {
  const login = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
  if (login.json?.session?.accessToken) {
    return { ok: true, existed: true, token: login.json.session.accessToken, user: login.json.session.user };
  }
  let send = await api("/api/auth", null, { action: "forgot_password", email, role: "boss" });
  if (send.status === 429) {
    await new Promise((r) => setTimeout(r, ((send.json?.retryAfterSec || 45) + 2) * 1000));
    send = await api("/api/auth", null, { action: "forgot_password", email, role: "boss" });
  }
  const code = send.json?.debugCode || send.json?.devCode;
  if (!code) {
    console.warn("forgot no debugCode", email, send.status, JSON.stringify(send.json).slice(0, 220));
    return null;
  }
  const verify = await api("/api/auth", null, {
    action: "forgot_verify_otp",
    email,
    code,
    role: "boss",
  });
  const resetToken = verify.json?.resetToken;
  if (!resetToken) {
    console.warn("forgot verify failed", JSON.stringify(verify.json).slice(0, 220));
    return null;
  }
  await api("/api/auth", null, {
    action: "forgot_reset_password",
    email,
    resetToken,
    password: PASS,
    newPassword: PASS,
    confirmPassword: PASS,
    role: "boss",
  });
  const login2 = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
  if (login2.json?.session?.accessToken) {
    return { ok: true, reset: true, token: login2.json.session.accessToken, user: login2.json.session.user };
  }
  return null;
}

async function registerBoss(email, displayName) {
  const viaLogin = await loginOrResetBoss(email, displayName);
  if (viaLogin?.token) return viaLogin;
  let send = await api("/api/auth", null, {
    action: "send_register_otp",
    email,
    role: "boss",
  });
  if (send.status === 429) {
    const wait = Number(send.json?.retryAfterSec || 25);
    await new Promise((r) => setTimeout(r, (wait + 2) * 1000));
    send = await api("/api/auth", null, { action: "send_register_otp", email, role: "boss" });
  }
  if (send.json?.code === "EMAIL_EXISTS_LOGIN") {
    const again = await loginOrResetBoss(email, displayName);
    if (again?.token) return again;
  }
  const code = send.json?.debugCode || send.json?.devCode;
  if (!code) {
    throw new Error(`no OTP for ${email}: ${send.status} ${JSON.stringify(send.json).slice(0, 200)}`);
  }
  const verify = await api("/api/auth", null, {
    action: "verify_register_otp",
    email,
    code,
    role: "boss",
  });
  const registerToken = verify.json?.registerToken || verify.json?.token || verify.json?.emailOtpToken;
  if (!registerToken) throw new Error(`no registerToken ${email}: ${JSON.stringify(verify.json).slice(0, 200)}`);
  const reg = await api("/api/auth", null, {
    action: "register",
    email,
    password: PASS,
    confirmPassword: PASS,
    displayName,
    registerToken,
    role: "boss",
  });
  if (!reg.json?.session?.accessToken && !reg.json?.ok) {
    const login = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
    if (login.json?.session?.accessToken) {
      return { ok: true, existed: true, token: login.json.session.accessToken, user: login.json.session.user };
    }
    throw new Error(`register failed ${email}: ${JSON.stringify(reg.json).slice(0, 240)}`);
  }
  return {
    ok: true,
    token: reg.json.session?.accessToken || (await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" })).json?.session?.accessToken,
    user: reg.json.session?.user,
  };
}

async function ensureCompanionViaApply(email, displayName, adminToken) {
  // Register as boss first (auth register always creates boss profile), then open companion role.
  let bossReg;
  try {
    bossReg = await registerBoss(email, displayName);
  } catch (e) {
    const login = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
    if (!login.json?.session?.accessToken) throw e;
    bossReg = { token: login.json.session.accessToken, user: login.json.session.user };
  }
  let token = bossReg.token;
  await api("/api/companion", token, {
    action: "apply_companion_role",
    nickname: displayName,
  });
  await api("/api/companion", token, {
    action: "submit_application",
    nickname: displayName,
    game: "王者荣耀",
    price: 35,
  });

  // Admin approve via players API (best-effort multiple action names)
  const list = await fetch(`${STG}/api/admin/players`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "x-mcj-access-token": adminToken,
      "x-mcj-admin-role": "admin",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "list" }),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const players = list.json?.players || list.json?.companions || list.json?.rows || list.json?.items || [];
  const hit = players.find(
    (p) =>
      String(p.email || "").toLowerCase() === email.toLowerCase() ||
      String(p.nickname || "") === displayName ||
      String(p.display_name || "") === displayName
  );
  const uid = hit?.user_id || hit?.userId || hit?.id || bossReg.user?.id;
  if (uid) {
    for (const action of ["approve", "approve_application", "set_verification", "publish", "set_online"]) {
      await api(
        "/api/admin/players",
        adminToken,
        {
          action,
          userId: uid,
          id: uid,
          verification_status: "approved",
          application_status: "approved",
          allow_orders: true,
          online: true,
          price: 35,
        },
        { "x-mcj-admin-role": "admin" }
      );
    }
  }
  const login2 = await api("/api/auth", null, { action: "login", email, password: PASS, role: "companion" });
  if (!login2.json?.session?.accessToken) {
    // companion portal may need hasCompanion — try boss token for companion bootstrap
    const loginBoss = await api("/api/auth", null, { action: "login", email, password: PASS, role: "boss" });
    return {
      ok: !!loginBoss.json?.session?.accessToken,
      token: loginBoss.json?.session?.accessToken,
      user: loginBoss.json?.session?.user || bossReg.user,
      adminHit: !!uid,
      companionLogin: false,
    };
  }
  return {
    ok: true,
    token: login2.json.session.accessToken,
    user: login2.json.session.user,
    adminHit: !!uid,
    companionLogin: true,
  };
}

const adminLogin = await api("/api/auth", null, {
  action: "login",
  email: "admin@meow.test",
  password: "McjTest@12345678",
  role: "admin",
});
const adminToken = adminLogin.json?.session?.accessToken;
if (!adminToken) {
  console.error("admin login failed", adminLogin.json);
  process.exit(1);
}

const accounts = [];
const boss = await registerBoss("organic.boss@mcj-staging-organic.invalid", "Organic Boss");
accounts.push({
  email: "organic.boss@mcj-staging-organic.invalid",
  role: "boss",
  id: boss.user?.id,
  ok: !!boss.token,
});

const inviteeBoss = await registerBoss("organic.invitee.boss@mcj-staging-organic.invalid", "Organic Invitee Boss");
accounts.push({
  email: "organic.invitee.boss@mcj-staging-organic.invalid",
  role: "boss",
  id: inviteeBoss.user?.id,
  ok: !!inviteeBoss.token,
});

const companion = await ensureCompanionViaApply(
  "organic.companion@mcj-staging-organic.invalid",
  "Organic Companion",
  adminToken
);
accounts.push({
  email: "organic.companion@mcj-staging-organic.invalid",
  role: "companion",
  id: companion.user?.id,
  ok: !!companion.token,
  adminHit: companion.adminHit,
});

const inviteeComp = await ensureCompanionViaApply(
  "organic.invitee.comp@mcj-staging-organic.invalid",
  "Organic Invitee Comp",
  adminToken
);
accounts.push({
  email: "organic.invitee.comp@mcj-staging-organic.invalid",
  role: "companion",
  id: inviteeComp.user?.id,
  ok: !!inviteeComp.token,
});

const out = {
  staging: STG,
  source: STAGING_ORGANIC_SOURCE,
  password: PASS,
  accounts,
  provisioned_at: new Date().toISOString(),
};
fs.writeFileSync(path.join(outDir, "organic-accounts.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(
  path.join(outDir, "organic-accounts.public.json"),
  JSON.stringify(
    {
      ...out,
      password: undefined,
      accounts: accounts.map((a) => ({ ...a, email: a.email.replace(/(.{3}).+(@.+)/, "$1***$2") })),
    },
    null,
    2
  )
);
console.log(JSON.stringify({ ok: accounts.every((a) => a.ok), accounts: accounts.map((a) => ({ email: a.email, ok: a.ok, id: a.id })) }, null, 2));
process.exit(accounts.every((a) => a.ok) ? 0 : 1);
