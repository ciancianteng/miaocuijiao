#!/usr/bin/env node
/**
 * Refuse aliasing Preview/Staging hosts onto Production domains.
 *
 * Usage:
 *   node scripts/assert-prod-domain-alias-safe.mjs <deploymentHost> <aliasHost>
 *
 * Exit 1 if aliasHost is a production domain and deployment is not Production-eligible.
 */
import { isProductionAppBase, hostnameOf } from "./lib/prod-guard.mjs";

const deployHost = hostnameOf(process.argv[2] || "");
const aliasHost = hostnameOf(process.argv[3] || "");

if (!deployHost || !aliasHost) {
  console.error("Usage: node scripts/assert-prod-domain-alias-safe.mjs <deployHost> <aliasHost>");
  process.exit(2);
}

const PROD_DOMAINS = new Set([
  "www.meowcuijiao.com",
  "meowcuijiao.com",
  "meow-cuijiao-homepage.vercel.app",
  "meow-cuijiao-homepage-ciancianteng-4581s-projects.vercel.app",
]);

const aliasIsProd = PROD_DOMAINS.has(aliasHost) || isProductionAppBase(aliasHost);
if (!aliasIsProd) {
  console.log(`[alias-safe] OK non-prod alias ${aliasHost} ← ${deployHost}`);
  process.exit(0);
}

// Production domains may only be pointed at hosts that look like Production deploys
// (no -git- branch previews, no staging alias names).
const looksPreview =
  /-git-/i.test(deployHost) ||
  /staging/i.test(deployHost) ||
  /preview/i.test(deployHost);

if (looksPreview) {
  console.error(
    `[alias-safe] REFUSED: cannot alias Production domain ${aliasHost} to preview/staging host ${deployHost}`
  );
  process.exit(1);
}

console.log(`[alias-safe] OK prod alias ${aliasHost} ← ${deployHost}`);
