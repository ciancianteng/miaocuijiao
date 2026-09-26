/**
 * Public build identity for staging SHA verification.
 * GET /api/build-info
 *
 * Exposes non-secret env isolation markers (never prints keys).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PRODUCTION_SUPABASE_REF = "jqfaknpmcnqwqvatrwgo";
const STAGING_SUPABASE_REF = "cfccwysniduwkjskiqgy";

function supabaseProjectRef(url = "") {
  const host = String(url || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return m ? m[1] : "";
}

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

export default async function handler(req, res) {
  const sha = readSha();
  const short = sha ? sha.slice(0, 7) : "";
  const sbUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const sbRef = supabaseProjectRef(sbUrl);
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  const isolationOk =
    (vercelEnv === "production" && sbRef === PRODUCTION_SUPABASE_REF) ||
    ((vercelEnv === "preview" || vercelEnv === "development") && sbRef !== PRODUCTION_SUPABASE_REF) ||
    !vercelEnv;
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    sha,
    short,
    ref: process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "",
    env: process.env.VERCEL_ENV || "",
    url: process.env.VERCEL_URL || "",
    supabaseRef: sbRef || null,
    supabaseIsProduction: sbRef === PRODUCTION_SUPABASE_REF,
    supabaseIsStaging: sbRef === STAGING_SUPABASE_REF,
    isolationOk,
    envLabel:
      vercelEnv === "production"
        ? "PRODUCTION"
        : vercelEnv === "preview"
          ? "STAGING/PREVIEW"
          : vercelEnv || "LOCAL",
    paySot: "orderPayMethods",
    at: new Date().toISOString(),
  });
}
