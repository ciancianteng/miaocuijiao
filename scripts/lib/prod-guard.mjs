/**
 * Runtime guard: refuse destructive/seed/E2E write scripts against known Production
 * Supabase projects.
 *
 * Staging and Production currently share project ref `jqfaknpmcnqwqvatrwgo`
 * (www.meowcuijiao.com realtime-config === staging realtime-config).
 * Until Staging has an isolated project, E2E seed/write/cleanup must not run
 * against this ref unless explicitly overridden.
 *
 * Override (emergency only) — either pair works:
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *   ALLOW_PROD_MUTATION=1      CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK
 */
import fs from "node:fs";
import path from "node:path";

const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze([
  "jqfaknpmcnqwqvatrwgo", // www.meowcuijiao.com (also currently used by staging Vercel)
]);

export function supabaseProjectRef(url = "") {
  const host = String(url || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return m ? m[1] : "";
}

export function isKnownProductionSupabase(url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "") {
  const ref = supabaseProjectRef(url);
  if (!ref) return false;
  const extra = String(process.env.MCJ_PRODUCTION_SUPABASE_REFS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const deny = new Set([...KNOWN_PRODUCTION_PROJECT_REFS, ...extra]);
  return deny.has(ref);
}

function prodWriteOverrideAllowed() {
  const a =
    process.env.ALLOW_PROD_SUPABASE_WRITE === "1" &&
    process.env.CONFIRM_PROD_WRITE === "I_UNDERSTAND_PROD_RISK";
  const b =
    process.env.ALLOW_PROD_MUTATION === "1" &&
    process.env.CONFIRM_PROD_MUTATION === "I_UNDERSTAND_PROD_RISK";
  return a || b;
}

/**
 * Load .env / .env.local into process.env (does not overwrite existing keys).
 * @param {string} root repo root
 */
export function loadEnvFiles(root = process.cwd()) {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] == null) process.env[key] = value;
    }
  }
}

export function assertNonProductionSupabase(scriptName = "script", url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "") {
  if (!isKnownProductionSupabase(url)) return { ok: true, ref: supabaseProjectRef(url), bypassed: false };
  if (prodWriteOverrideAllowed()) {
    console.warn(
      `[prod-guard] ALLOWED write to production Supabase by explicit override (${scriptName}) ref=${supabaseProjectRef(url)}`
    );
    return { ok: true, ref: supabaseProjectRef(url), bypassed: true };
  }
  const ref = supabaseProjectRef(url);
  const msg =
    `[prod-guard] Refusing ${scriptName}: Supabase project "${ref}" is a known Production ref ` +
    `(www.meowcuijiao.com). Staging must use an isolated project, or set ` +
    `ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK for emergency only.`;
  throw new Error(msg);
}

/** Call after loading .env.local into process.env */
export function guardAfterEnvLoad(scriptName = "script") {
  return assertNonProductionSupabase(scriptName);
}

/**
 * Compatibility alias used by existing main-branch seed/accept scripts.
 * @param {{ script?: string, url?: string }} [opts]
 */
export function assertSafeDbTarget(opts = {}) {
  const script = opts.script || opts.name || "script";
  const url = opts.url || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return assertNonProductionSupabase(script, url);
}
