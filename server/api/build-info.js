/**
 * Public build identity for staging SHA verification.
 * GET /api/build-info
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    sha,
    short,
    ref: process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "",
    env: process.env.VERCEL_ENV || "",
    url: process.env.VERCEL_URL || "",
    paySot: "orderPayMethods",
    at: new Date().toISOString(),
  });
}
