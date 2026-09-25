import fs from "node:fs";
import path from "node:path";

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!v || /SENSITIVE/i.test(v)) continue;
    o[m[1]] = v;
  }
  return o;
}

const env = {
  ...parseEnv(path.resolve("../meow-cuijiao-homepage/.env.local")),
  ...parseEnv(path.resolve(".env.local")),
};
const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");

async function one(table, q) {
  const r = await fetch(`${url}/rest/v1/${table}${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const t = await r.text();
  console.log("\n===", table, r.status, "===");
  console.log(t.slice(0, 2000));
}

await one("orders", "?select=*&limit=1");
await one("payment_receipts", "?select=*&limit=1");
