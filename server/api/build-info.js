/**
 * Public build identity for staging SHA verification.
 * GET /api/build-info
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  databaseProjectRef,
  isKnownProductionSupabase,
  isKnownStagingSupabase,
  supabaseProjectRef,
} from "../../scripts/lib/prod-guard.mjs";

function readSha() {
  try {
    const envSha =
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      process.env.MCJ_BUILD_SHA ||
      "";
    if (envSha) return String(envSha).trim();
  } catch {}
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {}
  try {
    const p = path.resolve(process.cwd(), "BUILD_SHA.txt");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch {}
  return "";
}

function jwtProjectRef(token) {
  const part = String(token || "").split(".")[1] || "";
  if (!part) return "";
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return String(json.ref || "").toLowerCase();
  } catch {
    return "";
  }
}

function resolvedSupabaseUrl() {
  const primary = String(process.env.SUPABASE_URL || "").trim();
  const vite = String(process.env.VITE_SUPABASE_URL || "").trim();
  const primaryRef = supabaseProjectRef(primary);
  const viteRef = supabaseProjectRef(vite);
  if (primary && vite && primaryRef && viteRef && primaryRef !== viteRef) return { ok: false, supabaseUrl: "" };
  if (primary && !primaryRef) return { ok: false, supabaseUrl: "" };
  const supabaseUrl = primary || vite;
  return { ok: Boolean(supabaseProjectRef(supabaseUrl)), supabaseUrl };
}

export function readEnvironmentIdentity() {
  const env = process.env.VERCEL_ENV || "";
  const resolved = resolvedSupabaseUrl();
  const supabaseRef = resolved.ok ? supabaseProjectRef(resolved.supabaseUrl) : "";
  const keyRef = jwtProjectRef(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "");
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const databaseRef = databaseUrl ? databaseProjectRef(databaseUrl) : "";
  const keyAgrees = !keyRef || keyRef === supabaseRef;
  const databaseAgrees = !databaseUrl || (Boolean(databaseRef) && databaseRef === supabaseRef);
  const supabaseIsProduction = Boolean(supabaseRef) && isKnownProductionSupabase(resolved.supabaseUrl);
  const supabaseIsStaging = Boolean(supabaseRef) && isKnownStagingSupabase(resolved.supabaseUrl) && !supabaseIsProduction;
  const isolationOk =
    env === "preview" &&
    resolved.ok &&
    supabaseIsStaging &&
    !supabaseIsProduction &&
    keyAgrees &&
    databaseAgrees;
  const envLabel = isolationOk ? "STAGING/PREVIEW" : supabaseIsProduction ? "PRODUCTION" : "UNCONFIRMED";
  return { env, supabaseRef, supabaseIsProduction, supabaseIsStaging, isolationOk, envLabel };
}

export default async function handler(req, res) {
  const sha = readSha();
  const short = sha ? sha.slice(0, 7) : "";
  const identity = readEnvironmentIdentity();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    sha,
    short,
    ref: process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "",
    env: identity.env,
    url: process.env.VERCEL_URL || "",
    supabaseRef: identity.supabaseRef,
    supabaseIsProduction: identity.supabaseIsProduction,
    supabaseIsStaging: identity.supabaseIsStaging,
    isolationOk: identity.isolationOk,
    envLabel: identity.envLabel,
    paySot: "orderPayMethods",
    at: new Date().toISOString(),
  });
}
