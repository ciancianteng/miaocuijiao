/**
 * Companion withdrawal full lifecycle accept harness (Staging only).
 * Guards Production via prod-guard when available.
 *
 * Usage:
 *   node scripts/e2e-withdraw-full.mjs
 *   node scripts/e2e-withdraw-full.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const API_BASE = (baseArg ? baseArg.slice(7) : process.env.PREVIEW_BASE || process.env.STAGING_BASE || "").replace(
  /\/$/,
  ""
);

async function maybeGuard(base) {
  try {
    const guard = await import("./lib/prod-guard.mjs");
    if (typeof guard.assertSmokeTargetAllowed === "function" && base) {
      guard.assertSmokeTargetAllowed(base);
    }
  } catch {
    /* optional on older branches */
  }
}

async function main() {
  console.log("e2e-withdraw-full");
  console.log("api_base", API_BASE || "(none)");

  // Always run offline invariants first.
  const verify = spawnSync(process.execPath, [path.join(root, "scripts", "verify-companion-withdrawal-settlement.mjs")], {
    stdio: "inherit",
  });
  if (verify.status !== 0) process.exit(verify.status || 1);

  if (!API_BASE) {
    console.log("SKIP live API (pass --base=Staging URL to exercise request_withdrawal)");
    process.exit(0);
  }

  await maybeGuard(API_BASE);
  const script = path.join(root, "scripts", "test-companion-withdraw.mjs");
  const r = spawnSync(process.execPath, [script, `--base=${API_BASE}`], { stdio: "inherit" });
  process.exit(r.status || 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
