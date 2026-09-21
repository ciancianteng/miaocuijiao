/**
 * Offline checks for CS bad_jwt / false-zero handling (no network / no Prod writes).
 * Usage: node scripts/verify-cs-bad-jwt-handling.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiSrc = fs.readFileSync(path.join(root, "server/api/customer-service.js"), "utf8");
const authSrc = fs.readFileSync(path.join(root, "src/customer-service-auth.js"), "utf8");
const uiSrc = fs.readFileSync(path.join(root, "src/customer-service-v2.js"), "utf8");

function check(name, cond) {
  assert.ok(cond, name);
  console.log(`PASS | ${name}`);
}

check("api-reads-msg", /body\.msg/.test(apiSrc) && /goTrueErrorText/.test(apiSrc));
check("api-reads-error_code", /error_code/.test(apiSrc) && /isAuthJwtFailure/.test(apiSrc));
check("api-maps-bad_jwt-401", /code:\s*"bad_jwt"/.test(apiSrc) && /status:\s*401/.test(apiSrc));
check("auth-expired-message", /登录状态已失效，请重新登录/.test(authSrc));
check("auth-detects-bad_jwt", /bad_jwt/.test(authSrc) && /isAuthUnauthorized/.test(authSrc));
check("auth-exports-helper", /isAuthUnauthorized:\s*isAuthUnauthorized/.test(authSrc));
check("ui-refresh-once", /refreshSession\(\)/.test(uiSrc) && /forceRelogin/.test(uiSrc));
check("ui-no-false-zero-profile", /moneyOrDash/.test(uiSrc) && /dataUnavailable\(\)/.test(uiSrc));
check("ui-dash-placeholder", /return '--'/.test(uiSrc) && /数据暂不可用/.test(uiSrc));
check("ui-no-0-0-fallback", !/att\.actualDays\|\|0\)\+' \/ '\+\(att\.standardDays\|\|0\)/.test(uiSrc));

console.log(
  JSON.stringify({
    ok: true,
    message: "CS bad_jwt / false-zero offline checks passed",
  })
);
