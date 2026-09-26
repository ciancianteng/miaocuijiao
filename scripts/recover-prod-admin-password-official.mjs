#!/usr/bin/env node
/**
 * Official Supabase Admin API password recovery for production admin
 * meowcuijiao@gmail.com (UUID 6f31b706-…).
 *
 * Does NOT edit auth.users.encrypted_password via SQL.
 * Uses GoTrue Admin PUT /auth/v1/admin/users/:id { password }.
 *
 * Required emergency override (Production write):
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *   CONFIRM_ADMIN_PASSWORD_RECOVERY=RESTORE_MEOWCUIJIAO_ADMIN
 *   node scripts/recover-prod-admin-password-official.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonProductionSupabase, loadEnvFiles, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
// Also load sibling checkout env (common on this machine) without overwriting explicit process.env.
for (const extra of [
  path.join(root, "..", "meow-cuijiao-homepage", ".env.local"),
  "C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local",
]) {
  if (!fs.existsSync(extra)) continue;
  for (const raw of fs.readFileSync(extra, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] == null) process.env[key] = value;
  }
  break;
}

const ADMIN_ID = "6f31b706-11e7-42df-8db1-d2caccd796de";
const ADMIN_EMAIL = "meowcuijiao@gmail.com";
const URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APPLY = process.env.CONFIRM_ADMIN_PASSWORD_RECOVERY === "RESTORE_MEOWCUIJIAO_ADMIN";
const outDir = path.join(root, "artifacts/p0-admin-login-fail");
fs.mkdirSync(outDir, { recursive: true });

function headers(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function main() {
  if (!URL || !SERVICE) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const ref = supabaseProjectRef(URL);
  if (ref !== "jqfaknpmcnqwqvatrwgo") {
    throw new Error(`Refusing: expected Production ref jqfaknpmcnqwqvatrwgo, got ${ref || "(empty)"}`);
  }
  // assertNonProduction throws unless emergency override is set — that's intentional.
  assertNonProductionSupabase("recover-prod-admin-password-official.mjs");

  const getRes = await fetch(`${URL}/auth/v1/admin/users/${ADMIN_ID}`, { headers: headers() });
  const before = await getRes.json().catch(() => ({}));
  const user = before?.user && typeof before.user === "object" ? before.user : before;
  if (!getRes.ok || !user?.id) throw new Error(`admin user fetch failed: ${getRes.status}`);
  if (String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    throw new Error(`email mismatch: expected ${ADMIN_EMAIL}, got ${user.email}`);
  }

  const plan = {
    at: new Date().toISOString(),
    apply: APPLY,
    ref,
    adminId: ADMIN_ID,
    email: ADMIN_EMAIL,
    before: {
      last_sign_in_at: user.last_sign_in_at,
      updated_at: user.updated_at,
      email_confirmed_at: user.email_confirmed_at,
      banned_until: user.banned_until,
    },
    method: "GoTrue Admin API PUT /auth/v1/admin/users/:id { password, user_metadata.must_change_password }",
    note:
      "Root cause: Auth user + admin profile healthy; credential grant rejects remembered password. No password_reset_requests for this admin. password_set_at was misleadingly stamped on every login.",
  };

  if (!APPLY) {
    fs.writeFileSync(path.join(outDir, "RECOVERY_DRY_RUN.json"), JSON.stringify(plan, null, 2));
    console.log(JSON.stringify({ ...plan, message: "Dry-run only. Set CONFIRM_ADMIN_PASSWORD_RECOVERY=RESTORE_MEOWCUIJIAO_ADMIN to apply." }, null, 2));
    return;
  }

  const tempPassword = `McjAdmin!${crypto.randomBytes(12).toString("base64url")}`;
  const prevMeta = (user.user_metadata && typeof user.user_metadata === "object" && user.user_metadata) || {};
  const now = new Date().toISOString();
  const putRes = await fetch(`${URL}/auth/v1/admin/users/${ADMIN_ID}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        ...prevMeta,
        has_password: true,
        password_set_at: now,
        must_change_password: true,
        password_recovery_reason: "p0_admin_login_fail_official_reset",
        password_recovery_at: now,
      },
      app_metadata: {
        ...((user.app_metadata && typeof user.app_metadata === "object" && user.app_metadata) || {}),
        has_password: true,
        must_change_password: true,
      },
    }),
  });
  const putBody = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    throw new Error(`password update failed: ${putRes.status} ${JSON.stringify(putBody).slice(0, 300)}`);
  }

  // Verify grant works (do not print token).
  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  const loginRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: tempPassword }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const grantOk = loginRes.ok && !!loginBody.access_token;

  const secretPath = path.join(outDir, "TEMP_PASSWORD.local.txt");
  fs.writeFileSync(
    secretPath,
    [
      `# DO NOT COMMIT — temporary production admin password`,
      `email=${ADMIN_EMAIL}`,
      `password=${tempPassword}`,
      `generated_at=${now}`,
      `must_change_password=true`,
      ``,
    ].join("\n"),
    { mode: 0o600 }
  );

  const result = {
    ...plan,
    applied: true,
    grantOk,
    secretPath,
    afterUpdatedAt: putBody?.user?.updated_at || putBody?.updated_at || null,
    message: "Official Admin API password recovery applied. Temp password written to TEMP_PASSWORD.local.txt (gitignored).",
  };
  fs.writeFileSync(path.join(outDir, "RECOVERY_APPLIED.json"), JSON.stringify({ ...result, password: undefined }, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
