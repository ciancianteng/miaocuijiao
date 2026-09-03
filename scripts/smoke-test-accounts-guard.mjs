/**
 * Offline checks for server/api/_test-accounts.js (no network).
 * Usage: node scripts/smoke-test-accounts-guard.mjs
 */
import {
  isProductionRuntime,
  isTestEmail,
  isTestUsername,
  isTestAccountRecord,
  shouldBlockTestIdentityOnProduction,
} from "../server/api/_test-accounts.js";

let passed = 0;
let failed = 0;

function check(id, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS | ${id}${detail ? ` | ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`FAIL | ${id}${detail ? ` | ${detail}` : ""}`);
  }
}

check("email-meow-test", isTestEmail("boss@meow.test"));
check("email-prod-smoke-domain", isTestEmail("x@mcj-prod-smoke.invalid"));
check("email-normal", !isTestEmail("user@example.com"));
check("name-prodsmoke", isTestUsername("ProdSmokeBoss2"));
check("name-service", isTestUsername("ProdSmokeService2"));
check("name-cs", isTestUsername("ProdSmokeCS"));
check("name-normal", !isTestUsername("真实老板"));
check(
  "record-flag",
  isTestAccountRecord({ email: "a@b.com", display_name: "ok", is_test_account: true })
);
check(
  "block-on-prod",
  shouldBlockTestIdentityOnProduction(
    { email: "boss@meow.test", displayName: "" },
    { VERCEL_ENV: "production" }
  )
);
check(
  "allow-on-staging",
  !shouldBlockTestIdentityOnProduction(
    { email: "boss@meow.test", displayName: "ProdSmokeBoss2" },
    { VERCEL_ENV: "preview" }
  )
);
check("runtime-prod", isProductionRuntime({ VERCEL_ENV: "production" }));
check("runtime-preview", !isProductionRuntime({ VERCEL_ENV: "preview" }));

console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} ${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
