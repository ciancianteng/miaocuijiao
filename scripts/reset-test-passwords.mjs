import fs from "node:fs";
import path from "node:path";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("reset-test-passwords.mjs");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("missing supabase admin env");
  process.exit(1);
}

const PASS = "McjTest@12345678";
const targets = [
  { id: "268e8205-0e09-4870-b44f-72676ade6ce5", email: "service.final.1785714993009@meow.test" },
  { id: "6f31b706-11e7-42df-8db1-d2caccd796de", email: "admin@meow.test" },
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
console.log(
  "verify admin",
  await login("/api/auth", {
    action: "login",
    email: "admin@meow.test",
    password: PASS,
    account: "admin@meow.test",
  })
);
console.log(
  "verify boss",
  await login("/api/auth", {
    action: "login",
    email: "boss.final.1785714993009@meow.test",
    password: PASS,
    account: "boss.final.1785714993009@meow.test",
  })
);
console.log(
  "verify companion",
  await login("/api/auth", {
    action: "login",
    email: "companion.idcard.1785715257525@meow.test",
    password: PASS,
    account: "companion.idcard.1785715257525@meow.test",
  })
);
