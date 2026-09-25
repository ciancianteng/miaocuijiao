/**
 * READ-ONLY Production gift schema probe. No writes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

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

const e = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
const url = String(e.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(e.SUPABASE_SERVICE_ROLE_KEY || "");
const ref = supabaseProjectRef(url);
console.log(JSON.stringify({ ref, isProd: ref === PRODUCTION_SUPABASE_REF, keyLen: key.length, hasUrl: !!url }));
if (ref !== PRODUCTION_SUPABASE_REF || !key || /SENSITIVE/i.test(key)) {
  console.error("REFUSE: need Production service role");
  process.exit(2);
}

async function probe(table, qs = "?select=id&limit=1") {
  const r = await fetch(`${url}/rest/v1/${table}${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const t = await r.text();
  return { table, status: r.status, body: t.slice(0, 200) };
}

for (const table of ["gifts", "gift_settings", "gift_transactions", "gift_orders", "companion_gift_wall"]) {
  console.log(JSON.stringify(await probe(table)));
}
const count = await fetch(`${url}/rest/v1/gifts?select=id&enabled=eq.true`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
});
console.log("gifts_count_header", count.headers.get("content-range"), count.status);
