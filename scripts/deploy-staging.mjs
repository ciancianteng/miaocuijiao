#!/usr/bin/env node
/**
 * Deploy current working tree to Vercel Preview, then point the fixed Staging alias.
 * Fixed URL: https://meow-cuijiao-homepage-staging.vercel.app/
 *
 * HARD RULES:
 * - Never pass --prod
 * - Never alias www.meowcuijiao.com / meowcuijiao.com
 */
import { spawnSync } from "node:child_process";
import { hostnameOf, isProductionAppBase } from "./lib/prod-guard.mjs";

const FIXED_ALIAS = "meow-cuijiao-homepage-staging.vercel.app";
const MIRROR_ALIAS = "meow-cuijiao-homepage-staging-ciancianteng-4581s-projects.vercel.app";
const FORBIDDEN_ALIASES = new Set([
  "www.meowcuijiao.com",
  "meowcuijiao.com",
  "meow-cuijiao-homepage.vercel.app",
  "meow-cuijiao-homepage-ciancianteng-4581s-projects.vercel.app",
]);

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

function assertAliasAllowed(aliasHost) {
  const host = hostnameOf(aliasHost);
  if (FORBIDDEN_ALIASES.has(host) || isProductionAppBase(host)) {
    console.error(`[deploy-staging] REFUSED: refusing to alias Production domain ${host}`);
    process.exit(1);
  }
}

assertAliasAllowed(FIXED_ALIAS);
assertAliasAllowed(MIRROR_ALIAS);

if (process.argv.includes("--prod")) {
  console.error("[deploy-staging] REFUSED: --prod is forbidden in staging deploy");
  process.exit(1);
}

console.log("[deploy-staging] deploying Preview (never --prod)…");
const deploy = run("npx", [
  "vercel",
  "deploy",
  "--yes",
  "--json",
  "--project",
  "meow-cuijiao-homepage",
]);
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
if (isProductionAppBase(host) || FORBIDDEN_ALIASES.has(hostnameOf(host))) {
  console.error(`[deploy-staging] REFUSED: deploy host looks like production: ${host}`);
  process.exit(1);
}

console.log(`[deploy-staging] alias → ${FIXED_ALIAS}`);
const alias = run("npx", ["vercel", "alias", "set", host, FIXED_ALIAS]);
process.stdout.write(alias.stdout || "");
if (alias.stderr) process.stderr.write(alias.stderr);
if (alias.status !== 0) {
  console.error("[deploy-staging] alias set failed");
  process.exit(alias.status || 1);
}

console.log(`[deploy-staging] alias → ${MIRROR_ALIAS}`);
const aliasMirror = run("npx", ["vercel", "alias", "set", host, MIRROR_ALIAS]);
process.stdout.write(aliasMirror.stdout || "");
if (aliasMirror.stderr) process.stderr.write(aliasMirror.stderr);

console.log("");
console.log("READY staging URL (fixed — refresh this only):");
console.log(`https://${FIXED_ALIAS}/`);
console.log(`(mirror) https://${MIRROR_ALIAS}/`);
console.log(`underlying deployment: https://${host}`);
