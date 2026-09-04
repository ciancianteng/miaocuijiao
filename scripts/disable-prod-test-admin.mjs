/**
 * Disable + rotate password for production test admin `admin@meow.test`.
 *
 * Does NOT delete the auth user or profile. Sets profiles.status=disabled and
 * rotates Auth password to a random opaque value so the known McjTest password
 * can no longer sign in.
 *
 * Runtime gate (no DB change): set DISABLE_PROD_TEST_ADMIN=1 (or ALLOW_PROD_TEST_ADMIN=0)
 * on Production to refuse admin@meow.test Admin Portal login after a formal admin exists.
 *
 * Emergency override required (this targets Production):
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *   CONFIRM_DISABLE_TEST_ADMIN=DISABLE_ADMIN_MEOW_TEST \
 *   node scripts/disable-prod-test-admin.mjs
 *
 * Dry-run (default without CONFIRM):
 *   node scripts/disable-prod-test-admin.mjs
 */
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonProductionSupabase, loadEnvFiles, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);

const TARGET_EMAIL = "admin@meow.test";
const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APPLY = process.env.CONFIRM_DISABLE_TEST_ADMIN === "DISABLE_ADMIN_MEOW_TEST";

function headers(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${String(text).slice(0, 240)}`);
  return data;
}

async function main() {
  if (!URL || !SERVICE) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  // Intentionally call assert — will throw unless emergency override is set.
  // Dry-run still requires override when pointing at prod so operators acknowledge risk.
  assertNonProductionSupabase("disable-prod-test-admin.mjs");

  const profiles = await rest(
    "profiles",
    `?email=eq.${encodeURIComponent(TARGET_EMAIL)}&select=id,email,role,status,display_name&limit=5`
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) {
    console.log(JSON.stringify({ ok: true, found: false, email: TARGET_EMAIL, ref: supabaseProjectRef(URL) }, null, 2));
    return;
  }

  const plan = {
    ok: true,
    apply: APPLY,
    ref: supabaseProjectRef(URL),
    email: TARGET_EMAIL,
    profileId: profile.id,
    role: profile.role,
    statusBefore: profile.status,
    actions: ["profiles.status=disabled", "auth password rotate (random)", "revoke sessions if supported"],
  };

  if (!APPLY) {
    console.log(JSON.stringify({ ...plan, message: "Dry-run only. Set CONFIRM_DISABLE_TEST_ADMIN=DISABLE_ADMIN_MEOW_TEST to apply." }, null, 2));
    return;
  }

  await rest(`profiles?id=eq.${encodeURIComponent(profile.id)}`, "", {
    method: "PATCH",
    body: { status: "disabled" },
  });

  const opaque = `Mcj!${crypto.randomBytes(24).toString("base64url")}`;
  const authRes = await fetch(`${URL}/auth/v1/admin/users/${profile.id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ password: opaque, ban_duration: "none", user_metadata: { must_change_password: true } }),
  });
  if (!authRes.ok) {
    const t = await authRes.text();
    throw new Error(`auth password rotate failed: ${authRes.status} ${t.slice(0, 200)}`);
  }

  console.log(
    JSON.stringify(
      {
        ...plan,
        statusAfter: "disabled",
        passwordRotated: true,
        message: "admin@meow.test disabled + password rotated. Known McjTest password no longer works.",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
