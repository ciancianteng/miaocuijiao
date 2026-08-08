/**
 * Verify companion-levels publish API on Staging (no Module Error).
 * node scripts/_verify-publish-levels.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const ADMIN = "admin@meow.test";

function mark(ok, id, note = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + note : ""}`);
  return ok;
}

async function main() {
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PASS }),
  }).then((r) => r.json());
  if (!mark(!!auth.access_token, "admin.auth")) process.exit(1);

  const headers = {
    Authorization: `Bearer ${auth.access_token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-mcj-admin-role": "admin",
  };

  const get = await fetch(`${BASE}/api/admin/companion-levels`, { headers }).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));
  const getOk = get.status === 200 && get.body.ok !== false && Array.isArray(get.body.levels);
  mark(getOk, "levels.GET", `http=${get.status} n=${get.body.levels?.length} msg=${get.body.message || ""}`);
  if (!getOk) {
    console.log(JSON.stringify(get.body).slice(0, 500));
    process.exit(1);
  }

  // Module error previously returned FUNCTION_INVOCATION_FAILED / SyntaxError on import
  const bad =
    /does not provide an export named|buildPublishSyncChecklist|SyntaxError|Cannot find module/i.test(
      JSON.stringify(get.body)
    );
  mark(!bad, "no.module.error.on.GET");

  const levels = get.body.levels;
  const pub = await fetch(`${BASE}/api/admin/companion-levels`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "publish", levels, syncCommission: true }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  const pubOk =
    (pub.status === 200 || pub.status === 207) &&
    Array.isArray(pub.body.checklist || pub.body.sync) &&
    !/does not provide an export named|buildPublishSyncChecklist/i.test(JSON.stringify(pub.body));
  mark(
    pubOk,
    "levels.publish",
    `http=${pub.status} ok=${pub.body.ok} checklist=${(pub.body.checklist || pub.body.sync || []).length} msg=${pub.body.message || ""}`
  );
  if (!pubOk) console.log(JSON.stringify(pub.body).slice(0, 600));

  // Spot-check admin page asset loads without module error in HTML
  const adminHtml = await fetch(`${BASE}/admin.html`).then((r) => r.text());
  mark(/admin-companion-levels\.js/.test(adminHtml), "admin.html.loads.levels.script");

  process.exit(pubOk && getOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
