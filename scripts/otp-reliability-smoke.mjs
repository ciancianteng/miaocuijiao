/**
 * Offline OTP reliability checks (no secrets / no live mailbox required).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = await import(pathToFileURL(path.join(root, "server/api/_otp-identity.js")).href);

// 1) Email normalize
assert.equal(identity.normalizeEmail("  Foo.Bar@Example.COM "), "foo.bar@example.com");
assert.equal(identity.isValidEmail("a@b.co"), true);
assert.equal(identity.isValidEmail("not-an-email"), false);

// 2) Malaysia phone unify
for (const raw of ["0123456789", "60123456789", "+60123456789", "012-345 6789"]) {
  const out = identity.normalizePhoneNumber(raw);
  assert.equal(out.ok, true, raw);
  assert.equal(out.e164, "+60123456789", raw);
}

// 3) Auth wiring: single /api/auth OTP actions + delivery flags + structured logs
const auth = readFileSync(path.join(root, "server/api/auth.js"), "utf8");
for (const needle of [
  "send_login_otp",
  "login_with_otp",
  "send_register_otp",
  "forgot_send_otp",
  'delivery: "suppressed"',
  "delivery: mailOk ? \"sent\" : \"failed\"",
  "otp_request",
  "otp_suppressed",
  "otp_provider_request",
  "otp_rate_limited",
  "otp_verify_success",
  "otp_verify_failed",
  "./_otp-identity.js",
]) {
  assert.match(auth, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "auth missing " + needle);
}

// 4) Frontend: boss home + companion share /api/auth send_login_otp; no false ok; scoped email
const gates = readFileSync(path.join(root, "src/role-gates.js"), "utf8");
assert.match(gates, /action:\s*"send_login_otp"/);
assert.match(gates, /j\.ok !== true/);
assert.match(gates, /function otpEmailNear/);
assert.match(gates, /source:\s*role === "companion" \? "companion_portal" : "boss_home"/);
assert.doesNotMatch(gates, /Notification\.requestPermission/);

const apply = readFileSync(path.join(root, "src/companion-application.js"), "utf8");
assert.match(apply, /send_login_otp/);
assert.match(apply, /body\.ok !== true/);
assert.match(apply, /source:\s*"companion_apply_login"/);

const workbench = readFileSync(path.join(root, "src/companion-workbench.js"), "utf8");
assert.match(workbench, /data-send-login-otp/);
assert.match(workbench, /data-login-role="companion"/);

const indexHtml = readFileSync(path.join(root, "index.html"), "utf8");
assert.match(indexHtml, /data-send-login-otp/);
assert.match(indexHtml, /data-login-role="boss"/);
assert.match(indexHtml, /id="loginOtpEmail"/);

// 5) No private secrets in client
for (const file of ["src/role-gates.js", "src/otp-cooldown.js", "index.html"]) {
  const text = readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(text, /RESEND_API_KEY\s*=\s*['\"][^'\"]+/);
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY/);
}

console.log("OTP_RELIABILITY_SMOKE: PASS");
