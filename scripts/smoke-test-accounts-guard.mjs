/**
 * Offline checks for server/api/_test-accounts.js (no network).
 * Usage: node scripts/smoke-test-accounts-guard.mjs
 */
import {
  isProductionRuntime,
  isTestEmail,
  isTestUsername,
  isTestAccountRecord,
  isAutomatedTestOrderRecord,
  isProtectedProductionBusinessIdentity,
  productionOrderWriteBlock,
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
check("email-guerrilla", isTestEmail("brnwxnfv@guerrillamailblock.com"));
check("email-sharklasers", isTestEmail("x@sharklasers.com"));
check("email-normal", !isTestEmail("user@example.com"));
check("name-prodsmoke", isTestUsername("ProdSmokeBoss2"));
check("name-service", isTestUsername("ProdSmokeService2"));
check("name-cs", isTestUsername("ProdSmokeCS"));
check("name-normal", !isTestUsername("真实老板"));
check(
  "automated-wp-biz",
  isAutomatedTestOrderRecord({ title: "WP-BIZ-E2E-A", description: "webpush-biz-e2e-complete" })
);
check("real-order-not-automated", !isAutomatedTestOrderRecord({ title: "手瓦上分", description: "顶尖青年音" }));
check(
  "prod-blocks-wp-biz-on-real-user",
  productionOrderWriteBlock(
    { profile: { email: "a@gmail.com", display_name: "1717" }, body: { title: "WP-BIZ-E2E-B" } },
    { VERCEL_ENV: "production" }
  )?.code === "PROD_AUTOMATED_ORDER_BLOCKED"
);
check(
  "preview-allows-wp-biz-payload",
  productionOrderWriteBlock(
    { profile: { email: "a@gmail.com", display_name: "1717" }, body: { title: "WP-BIZ-E2E-B" } },
    { VERCEL_ENV: "preview" }
  ) == null
);
check("protected-1717", isProtectedProductionBusinessIdentity("1717"));
check("protected-pw21", isProtectedProductionBusinessIdentity("PW00021"));
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
