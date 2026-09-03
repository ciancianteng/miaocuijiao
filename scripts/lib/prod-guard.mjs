/**
 * Environment protection for seed / E2E / smoke scripts.
 *
 * Policy (hard rule):
 * - Automated tests and smoke scripts may write ONLY to Staging.
 * - Production (www.meowcuijiao.com / jqfaknpmcnqwqvatrwgo) is denied by default.
 * - Production data creation requires explicit dual confirmation (emergency only).
 *
 * Staging Supabase:  cfccwysniduwkjskiqgy
 * Production Supabase: jqfaknpmcnqwqvatrwgo
 *
 * Override (emergency only) — either pair:
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *   ALLOW_PROD_MUTATION=1      CONFIRM_PROD_MUTATION=I_UNDERSTAND_PROD_RISK
 *
 * Staging-only smoke helpers:
 *   assertSmokeTargetAllowed({ script, base, supabaseUrl })
 *   guardSmokeScript(scriptName, root) — load env then enforce Staging-only policy
 */
import fs from "node:fs";
import path from "node:path";

export const STAGING_SUPABASE_REF = "cfccwysniduwkjskiqgy";
export const PRODUCTION_SUPABASE_REF = "jqfaknpmcnqwqvatrwgo";

const KNOWN_PRODUCTION_PROJECT_REFS = Object.freeze([PRODUCTION_SUPABASE_REF]);
const KNOWN_STAGING_PROJECT_REFS = Object.freeze([STAGING_SUPABASE_REF]);

const PRODUCTION_HOST_RE = /(?:^|\.)meowcuijiao\.com$/i;
const STAGING_HOST_HINT_RE = /staging|vercel\.app|localhost|127\.0\.0\.1/i;

export function supabaseProjectRef(url = "") {
  const host = String(url || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return m ? m[1] : "";
}

export function hostnameOf(urlOrHost = "") {
  const raw = String(urlOrHost || "").trim();
  if (!raw) return "";
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).hostname.toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  }
}

/** Compatibility alias used by PR #148 callers. */
export function isProductionHostname(urlOrHost = "") {
  return isProductionAppBase(urlOrHost);
}

function extraRefsFromEnv(key) {
  return String(process.env[key] || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isKnownProductionSupabase(
  url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
) {
  const ref = supabaseProjectRef(url);
  if (!ref) return false;
  const deny = new Set([
    ...KNOWN_PRODUCTION_PROJECT_REFS,
    ...extraRefsFromEnv("MCJ_PRODUCTION_SUPABASE_REFS"),
  ]);
  return deny.has(ref);
}

export function isKnownStagingSupabase(
  url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
) {
  const ref = supabaseProjectRef(url);
  if (!ref) return false;
  const allow = new Set([
    ...KNOWN_STAGING_PROJECT_REFS,
    ...extraRefsFromEnv("MCJ_STAGING_SUPABASE_REFS"),
  ]);
  return allow.has(ref);
}

export function isProductionAppBase(base = "") {
  const host = hostnameOf(base);
  if (!host) return false;
  if (STAGING_HOST_HINT_RE.test(host) && !PRODUCTION_HOST_RE.test(host)) return false;
  return PRODUCTION_HOST_RE.test(host);
}

export function isStagingOrPreviewAppBase(base = "") {
  const host = hostnameOf(base);
  if (!host) return false;
  if (isProductionAppBase(base)) return false;
  return STAGING_HOST_HINT_RE.test(host);
}

/** Compatibility: detect production-ish env flags (does not alone authorize writes). */
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
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] == null) process.env[key] = value;
    }
  }
}

export function assertNonProductionSupabase(
  scriptName = "script",
  url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
) {
  if (!isKnownProductionSupabase(url)) {
    return { ok: true, ref: supabaseProjectRef(url), bypassed: false };
  }
  if (prodWriteOverrideAllowed()) {
    console.warn(
      `[prod-guard] ALLOWED write to production Supabase by explicit override (${scriptName}) ref=${supabaseProjectRef(url)}`
    );
    return { ok: true, ref: supabaseProjectRef(url), bypassed: true };
  }
  const ref = supabaseProjectRef(url);
  throw new Error(
    `[prod-guard] Refusing ${scriptName}: Supabase project "${ref}" is Production ` +
      `(www.meowcuijiao.com). Tests/smoke may only write to Staging (${STAGING_SUPABASE_REF}). ` +
      `Emergency override requires ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK.`
  );
}

/** Call after loading .env.local into process.env */
export function guardAfterEnvLoad(scriptName = "script") {
  return assertNonProductionSupabase(scriptName);
}

/**
 * Compatibility alias used by existing seed/accept scripts.
 * @param {{ script?: string, name?: string, url?: string }} [opts]
 */
export function assertSafeDbTarget(opts = {}) {
  const script = opts.script || opts.name || "script";
  const url = opts.url || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return assertNonProductionSupabase(script, url);
}

/**
 * Hard staging-only gate for smoke / E2E scripts that create records.
 * Blocks Production app hosts, Production Supabase ref, and Production DATABASE_URL.
 *
 * @param {{ script?: string, name?: string, base?: string, supabaseUrl?: string, databaseUrl?: string, requireStagingSupabase?: boolean }} opts
 */
export function assertSmokeTargetAllowed(opts = {}) {
  const script = opts.script || opts.name || "smoke";
  const base =
    opts.base ||
    process.env.BASE ||
    process.env.BASE_URL ||
    process.env.MCJ_STAGING_URL ||
    process.env.MCJ_PREVIEW_URL ||
    process.env.PREVIEW ||
    "";
  const supabaseUrl =
    opts.supabaseUrl ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "";
  const databaseUrl =
    opts.databaseUrl ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DIRECT_URL ||
    "";

  if (base && isProductionAppBase(base) && !prodWriteOverrideAllowed()) {
    throw new Error(
      `[prod-guard] Refusing ${script}: BASE "${base}" is Production. ` +
        `Smoke/E2E must use Staging/Preview only. ` +
        `Emergency override requires ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK.`
    );
  }

  if (supabaseUrl) {
    assertNonProductionSupabase(script, supabaseUrl);
    if (
      opts.requireStagingSupabase &&
      !isKnownStagingSupabase(supabaseUrl) &&
      !prodWriteOverrideAllowed()
    ) {
      throw new Error(
        `[prod-guard] Refusing ${script}: Supabase "${supabaseProjectRef(supabaseUrl)}" is not Staging (${STAGING_SUPABASE_REF}).`
      );
    }
  }

  const dbBlob = String(databaseUrl || "");
  if (
    dbBlob &&
    dbBlob.toLowerCase().includes(PRODUCTION_SUPABASE_REF) &&
    !prodWriteOverrideAllowed()
  ) {
    throw new Error(
      `[prod-guard] Refusing ${script}: DATABASE_URL points at Production ref ${PRODUCTION_SUPABASE_REF}.`
    );
  }
  if (
    opts.requireStagingSupabase &&
    dbBlob &&
    !dbBlob.toLowerCase().includes(STAGING_SUPABASE_REF) &&
    !prodWriteOverrideAllowed()
  ) {
    throw new Error(
      `[prod-guard] Refusing ${script}: DATABASE_URL does not reference Staging ${STAGING_SUPABASE_REF}.`
    );
  }

  if (base && !isStagingOrPreviewAppBase(base) && !prodWriteOverrideAllowed()) {
    throw new Error(
      `[prod-guard] Refusing ${script}: BASE "${base}" is not a recognized Staging/Preview/local host.`
    );
  }

  return {
    ok: true,
    base,
    supabaseRef: supabaseProjectRef(supabaseUrl),
    stagingRef: STAGING_SUPABASE_REF,
    productionRef: PRODUCTION_SUPABASE_REF,
    bypassed: prodWriteOverrideAllowed(),
  };
}

/**
 * Convenience for smoke/E2E entrypoints: load env then refuse production writes
 * (Supabase URL + optional BASE / BASE_URL / PREVIEW from env or argv).
 */
export function guardSmokeScript(scriptName = "smoke-script", root = process.cwd(), opts = {}) {
  loadEnvFiles(root);
  const argvBase = process.argv.find((a) => a.startsWith("--base="))?.slice(7) || process.argv[2] || "";
  const base =
    opts.base ||
    process.env.BASE ||
    process.env.BASE_URL ||
    process.env.PREVIEW ||
    process.env.MCJ_STAGING_URL ||
    process.env.MCJ_PREVIEW_URL ||
    (argvBase && !argvBase.startsWith("-") ? argvBase : "");
  return assertSmokeTargetAllowed({
    script: scriptName,
    base: base || undefined,
    ...opts,
  });
}

/** Convenience: load env files then enforce smoke staging-only policy. */
export function guardSmokeAfterEnvLoad(scriptName = "smoke", opts = {}) {
  loadEnvFiles(opts.root || process.cwd());
  return assertSmokeTargetAllowed({ script: scriptName, ...opts });
}
