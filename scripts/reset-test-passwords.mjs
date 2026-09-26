import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

/**
 * Staging-only helper for rotating KNOWN STAGING test passwords.
 * NEVER target Production real admin UUID (meowcuijiao@gmail.com).
 */
guardAfterEnvLoad("reset-test-passwords.mjs");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing supabase admin env");
  process.exit(1);
}

const PASS = "McjTest@12345678";
// Staging test fixtures only — do NOT include production admin UUID
// 6f31b706-11e7-42df-8db1-d2caccd796de (meowcuijiao@gmail.com).
const targets = [
  { id: "268e8205-0e09-4870-b44f-72676ade6ce5", email: "service.final.1785714993009@meow.test" },
];

for (const t of targets) {
  const res = await fetch(`${url}/auth/v1/admin/users/${t.id}`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: PASS, email_confirm: true }),
  });
  const body = await res.json().catch(() => ({}));
  console.log("reset", t.email, res.status, body?.email || body?.msg || body?.message || "ok");
}

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
async function login(apiPath, body) {
  const res = await fetch(`${BASE}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: !!j.ok, message: j.message || String(res.status), redirect: j.redirect || "" };
}

console.log(
  "verify cs",
  await login("/api/customer-service?action=login", {
    account: "service.final.1785714993009@meow.test",
    password: PASS,
    email: "service.final.1785714993009@meow.test",
  })
);
