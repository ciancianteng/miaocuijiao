#!/usr/bin/env node
/**
 * Deploy current working tree to Vercel Preview, then point the fixed Staging alias.
 * Fixed URL: https://meow-cuijiao-homepage-staging.vercel.app/
 */
import { spawnSync } from "node:child_process";

const FIXED_ALIAS = "meow-cuijiao-homepage-staging.vercel.app";
const MIRROR_ALIAS = "meow-cuijiao-homepage-staging-ciancianteng-4581s-projects.vercel.app";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
    ...opts,
  });
  return res;
}

function extractUrl(text) {
  if (!text) return null;
  try {
    const j = JSON.parse(text.trim());
    const u = j?.url || j?.deployment?.url || j?.alias?.[0];
    if (u) return String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
  } catch {
    /* not json */
  }
  const m =
    text.match(/https:\/\/([a-z0-9.-]+\.vercel\.app)/i) ||
    text.match(/\b([a-z0-9-]+-[a-z0-9-]+-[a-z0-9.-]*\.vercel\.app)\b/i);
  return m ? m[1].replace(/^https?:\/\//, "") : null;
}

console.log("[deploy-staging] deploying…");
const deploy = run("npx", ["vercel", "deploy", "--yes", "--json"]);
const combined = `${deploy.stdout || ""}\n${deploy.stderr || ""}`;
process.stdout.write(deploy.stdout || "");
if (deploy.stderr) process.stderr.write(deploy.stderr);

if (deploy.status !== 0) {
  console.error("[deploy-staging] vercel deploy failed");
  process.exit(deploy.status || 1);
}

const host = extractUrl(deploy.stdout || "") || extractUrl(combined);
if (!host) {
  console.error("[deploy-staging] could not parse deployment URL");
  process.exit(1);
}

console.log(`[deploy-staging] alias → ${FIXED_ALIAS}`);
const alias = run("npx", ["vercel", "alias", "set", host, FIXED_ALIAS, "--yes"]);
process.stdout.write(alias.stdout || "");
if (alias.stderr) process.stderr.write(alias.stderr);
if (alias.status !== 0) {
  console.error("[deploy-staging] alias set failed");
  process.exit(alias.status || 1);
}

console.log("");
console.log("READY staging URL (fixed — refresh this only):");
console.log(`https://${FIXED_ALIAS}/`);
console.log(`(mirror) https://${MIRROR_ALIAS}/`);
console.log(`underlying deployment: https://${host}`);
