#!/usr/bin/env node
/**
 * Staging-only: reset password for known hall companions so accept E2E can login.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

const env = {
  ...parseEnv(path.join(root, ".env.staging.local")),
  ...process.env,
};
const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("missing staging supabase url/key");
  process.exit(2);
}
const ref = new URL(url).hostname.split(".")[0];
if (ref !== STAGING_SUPABASE_REF) {
  console.error("refusing non-staging", ref);
  process.exit(2);
}
assertSmokeTargetAllowed({
  script: "staging-reset-companion-passwords",
  base: "https://meow-cuijiao-homepage-staging.vercel.app",
  supabaseUrl: url,
});

const PASS = "McjTest@12345678";
const targets = [
  { email: "e2e275.comp.1789912233591@example.com", userId: "6f9ddd12-6805-48dc-bb0f-78649b096d39" },
  { email: "e2e275.admin.comp2.1789912163362@example.com", userId: "b5ea23d2-7856-4762-be8d-0051f1b646d1" },
];

for (const t of targets) {
  const r = await fetch(`${url}/auth/v1/admin/users/${t.userId}`, {
    method: "PUT",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: PASS, email_confirm: true }),
  });
  const body = await r.text();
  console.log(t.email, r.status, body.slice(0, 120));
}
