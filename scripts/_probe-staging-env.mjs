import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, ".env.staging.local"),
  path.join(root, ".env.staging.pulled.local"),
  path.join(root, "../meow-cuijiao-homepage/.env.staging.local"),
  path.join(root, "../meow-cuijiao-homepage/.env.staging"),
  path.join(process.env.USERPROFILE || "", ".mcj-staging.env"),
  path.join(process.env.USERPROFILE || "", ".cursor", "mcj-staging.env"),
];

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return null;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

for (const p of candidates) {
  const e = parseEnv(p);
  if (!e) {
    console.log(JSON.stringify({ path: p, exists: false }));
    continue;
  }
  const url = e.STAGING_SUPABASE_URL || e.SUPABASE_URL || e.VITE_SUPABASE_URL || "";
  const key = e.STAGING_SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SERVICE_ROLE_KEY || "";
  const anon = e.SUPABASE_ANON_KEY || e.VITE_SUPABASE_ANON_KEY || "";
  const ref = supabaseProjectRef(url);
  console.log(
    JSON.stringify({
      path: p,
      exists: true,
      ref,
      isStaging: ref === STAGING_SUPABASE_REF,
      isProd: ref === PRODUCTION_SUPABASE_REF,
      keyLen: key.length,
      keySensitive: /SENSITIVE/i.test(key),
      anonLen: anon.length,
      hasUrl: !!url,
      keys: Object.keys(e).filter((k) => /SUPABASE|STAGING|DATABASE|PASSWORD/i.test(k)),
    })
  );
}
