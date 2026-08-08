import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const rows = await c.query(`
  select id, email, display_name, status, role
  from profiles
  where role::text in ('customer_service','admin','super_admin')
  order by created_at desc
`);
console.log("cs/admin rows", JSON.stringify(rows.rows, null, 2));

async function tryAuth(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS, account: email }),
  });
  const j = await res.json().catch(() => ({}));
  console.log("auth", email, j.ok, j.message || res.status, j.redirect || "");
  const res2 = await fetch(`${BASE}/api/customer-service?action=login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: email, password: PASS, email }),
  });
  const j2 = await res2.json().catch(() => ({}));
  console.log("cs-login", email, j2.ok, j2.message || res2.status);
}

for (const r of rows.rows) {
  if (r.email) await tryAuth(r.email);
}
await c.end();
