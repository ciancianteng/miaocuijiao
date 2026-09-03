/**
 * Runtime guard: refuse destructive/seed/E2E write scripts against known Production
 * Supabase projects and production hostnames.
 *
 * Production ref: jqfaknpmcnqwqvatrwgo (www.meowcuijiao.com)
 * Staging ref (isolated): cfccwysniduwkjskiqgy
 *
 * Override (emergency only) — either pair works:
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *   ALLOW_PROD_MUTATION=1      CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK
 */
import fs from "node:fs";
import path from "node:path";

const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze([
  "jqfaknpmcnqwqvatrwgo", // www.meowcuijiao.com
]);

const KNOWN_PRODUCTION_HOST_RE =
  /(^|\.)meowcuijiao\.com$/i;

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

export function isProductionHostname(urlOrHost = "") {
  const raw = String(urlOrHost || "").trim();
  if (!raw) return false;
  try {
    const host = raw.includes("://") ? new URL(raw).hostname : raw.split("/")[0];
    return KNOWN_PRODUCTION_HOST_RE.test(host.replace(/^www\./i, "www.")) || /^www\.meowcuijiao\.com$/i.test(host) || /^meowcuijiao\.com$/i.test(host);
  } catch {
    return /meowcuijiao\.com/i.test(raw) && !/staging|preview|vercel\.app/i.test(raw);
  }
}

export function isProductionEnvFlag(env = process.env) {
  const vercel = String(env.VERCEL_ENV || "").toLowerCase();
  const app = String(env.APP_ENV || "").toLowerCase();
  return vercel === "production" || app === "production";
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
      const value = line.slice(eq + 1).trim().replace(/^['"]|["']$/g, "");
      if (key && process.env[key] == null) process.env[key] = value;
    }
  }
}

function productionTargetReason(url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "") {
  if (isProductionEnvFlag()) return `APP/VERCEL_ENV=production`;
  if (isKnownProductionSupabase(url)) return `Supabase ref=${supabaseProjectRef(url)}`;
  const base =
    process.env.BASE_URL ||
    process.env.PREVIEW ||
    process.env.MCJ_STAGING_URL ||
    process.env.PRODUCTION_URL ||
    "";
  if (base && isProductionHostname(base)) return `BASE_URL host=${base}`;
  return "";
}

export function assertNonProductionSupabase(scriptName = "script", url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "") {
  const reason = productionTargetReason(url);
  if (!reason) return { ok: true, ref: supabaseProjectRef(url), bypassed: false };
  if (prodWriteOverrideAllowed()) {
    console.warn(
      `[prod-guard] ALLOWED write to production by explicit override (${scriptName}) reason=${reason}`
    );
    return { ok: true, ref: supabaseProjectRef(url), bypassed: true };
  }
  const msg =
    `[prod-guard] Refusing ${scriptName}: target looks like Production (${reason}). ` +
    `Smoke/E2E/seed scripts must not write to www.meowcuijiao.com. ` +
    `Use Staging, or set ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK for emergency only.`;
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

/**
 * Convenience for smoke/E2E entrypoints: load env then refuse production writes.
 */
export function guardSmokeScript(scriptName = "smoke-script", root = process.cwd()) {
  loadEnvFiles(root);
  return assertNonProductionSupabase(scriptName);
}
