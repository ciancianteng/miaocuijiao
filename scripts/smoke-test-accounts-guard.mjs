/**
 * Offline checks for server/api/_test-accounts.js (no network).
 * Usage: node scripts/smoke-test-accounts-guard.mjs
 */
import {
  isProductionRuntime,
  isTestEmail,
  isTestUsername,
  isTestAccountRecord,
  isExplicitSmokeIdentity,
  isBootstrapTestAdmin,
  isProdTestAdminBootstrapEnabled,
  shouldBlockTestIdentityOnProduction,
  productionTestAccountWriteBlock,
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

const PROD = { VERCEL_ENV: "production" };
const PREVIEW = { VERCEL_ENV: "preview" };

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
  "block-boss-fixture-on-prod",
  shouldBlockTestIdentityOnProduction({ email: "boss@meow.test", displayName: "" }, PROD)
);
check(
  "allow-on-staging",
  !shouldBlockTestIdentityOnProduction(
    { email: "boss@meow.test", displayName: "ProdSmokeBoss2" },
    PREVIEW
  )
);
check("runtime-prod", isProductionRuntime(PROD));
check("runtime-preview", !isProductionRuntime(PREVIEW));

check("bootstrap-admin-email", isBootstrapTestAdmin("admin@meow.test"));
check(
  "admin-portal-login-allowed",
  !shouldBlockTestIdentityOnProduction(
    { email: "admin@meow.test", loginPortal: "admin", purpose: "login" },
    PROD
  )
);
check(
  "admin-boss-portal-blocked",
  shouldBlockTestIdentityOnProduction(
    { email: "admin@meow.test", loginPortal: "boss", purpose: "login" },
    PROD
  )
);
check(
  "admin-register-blocked",
  shouldBlockTestIdentityOnProduction({ email: "admin@meow.test", purpose: "register" }, PROD)
);
check(
  "admin-portal-disabled-by-env",
  shouldBlockTestIdentityOnProduction(
    { email: "admin@meow.test", loginPortal: "admin" },
    { ...PROD, DISABLE_PROD_TEST_ADMIN: "1" }
  )
);
check(
  "admin-portal-disabled-by-allow-0",
  shouldBlockTestIdentityOnProduction(
    { email: "admin@meow.test", loginPortal: "admin" },
    { ...PROD, ALLOW_PROD_TEST_ADMIN: "0" }
  )
);
check("bootstrap-enabled-default", isProdTestAdminBootstrapEnabled(PROD));

check("explicit-smoke-boss", isExplicitSmokeIdentity({ email: "boss@meow.test" }));
check("explicit-smoke-ui-accept", isExplicitSmokeIdentity({ email: "ui.accept.boss.1@meow.test" }));
check(
  "explicit-not-arbitrary-meow-test",
  !isExplicitSmokeIdentity({ email: "ops.person@meow.test", displayName: "运营小王" })
);
check(
  "login-allows-non-fixture-meow-test",
  !shouldBlockTestIdentityOnProduction(
    { email: "ops.person@meow.test", displayName: "运营小王", loginPortal: "boss" },
    PROD
  )
);
check(
  "register-blocks-any-meow-test",
  shouldBlockTestIdentityOnProduction(
    { email: "ops.person@meow.test", purpose: "register" },
    PROD
  )
);
check(
  "write-block-still-uses-meow-test",
  !!productionTestAccountWriteBlock({ email: "ops.person@meow.test" }, PROD)
);
check(
  "write-block-admin-email",
  !!productionTestAccountWriteBlock({ email: "admin@meow.test", role: "admin" }, PROD)
);
check(
  "write-allow-real-user",
  !productionTestAccountWriteBlock({ email: "real@gmail.com", display_name: "凝梦" }, PROD)
);

console.log(`SUMMARY ${failed === 0 ? "PASS" : "FAIL"} ${passed}/${passed + failed}`);
process.exit(failed === 0 ? 0 : 1);
