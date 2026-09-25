#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(p) {
  const o = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}
const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = new URL(url).hostname.split(".")[0];
console.log(JSON.stringify({ urlHost: new URL(url).hostname, ref, isProd: ref === PRODUCTION_SUPABASE_REF, isStg: ref === STAGING_SUPABASE_REF }, null, 2));
const h = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
const latest = await fetch(
  url + "/rest/v1/orders?select=order_no,order_type,parent_order_id,status,created_at&order=created_at.desc&limit=20",
  { headers: h }
);
console.log("latest_status", latest.status);
console.log(await latest.text());
