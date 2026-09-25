/**
 * Pull Vercel Preview env and write Staging-only secrets to .env.staging.local
 * Refuses if SUPABASE_URL is not Staging ref. Never prints secret values.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = path.join(root, ".env.vercel.staging.pull.tmp");
const out = path.join(root, ".env.staging.local");

function parseEnvText(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!v || /\[SENSITIVE\]/i.test(v)) continue;
    env[m[1]] = v;
  }
  return env;
}

const pull = spawnSync(
  "npx",
  ["vercel", "env", "pull", tmp, "--project", "meow-cuijiao-homepage", "--environment=preview", "--yes"],
  { encoding: "utf8", shell: true, cwd: root, maxBuffer: 20 * 1024 * 1024 }
);
if (pull.status !== 0) {
  console.error("vercel env pull failed", pull.status);
  console.error((pull.stderr || "").slice(0, 800));
  process.exit(pull.status || 1);
}

const raw = fs.readFileSync(tmp, "utf8");
try {
  fs.unlinkSync(tmp);
} catch {
  /* ignore */
}

const env = parseEnvText(raw);
const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ref = supabaseProjectRef(url);
const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
const anon = String(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "");

console.log(
  JSON.stringify({
    ref,
    isStaging: ref === STAGING_SUPABASE_REF,
    isProd: ref === PRODUCTION_SUPABASE_REF,
    keyLen: key.length,
    anonLen: anon.length,
    hasUrl: !!url,
  })
);

if (ref !== STAGING_SUPABASE_REF) {
  console.error("REFUSE: Preview env is not Staging Supabase");
  process.exit(2);
}
if (!key || key.length < 20) {
  console.error("REFUSE: missing service role key");
  process.exit(3);
}

const lines = [
  `# Staging-only — auto-generated, do not commit`,
  `STAGING_SUPABASE_URL=${url}`,
  `SUPABASE_URL=${url}`,
  `STAGING_SUPABASE_SERVICE_ROLE_KEY=${key}`,
  `SUPABASE_SERVICE_ROLE_KEY=${key}`,
  `SUPABASE_ANON_KEY=${anon}`,
  `VITE_SUPABASE_URL=${url}`,
  `VITE_SUPABASE_ANON_KEY=${anon}`,
  "",
];
fs.writeFileSync(out, lines.join("\n"), { mode: 0o600 });
console.log("wrote", out, "ok");
