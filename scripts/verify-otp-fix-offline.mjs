#!/usr/bin/env node
/**
 * Offline OTP fix verification (no network / no DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const otpStoreSrc = readFileSync("server/api/_otp-store.js", "utf8");
const authSrc = readFileSync("server/api/auth.js", "utf8");
const mig = readFileSync("supabase/migrations/20260908_otp_password_reset_requests_fix.sql", "utf8");
const pending = readFileSync("supabase/pending-prod/12_otp_password_reset_requests_fix.sql", "utf8");
const forgotSrc = readFileSync("src/forgot-password.js", "utf8");
const roleGatesSrc = readFileSync("src/role-gates.js", "utf8");

// Store: no platform_settings fallback implementation (comments may mention it)
assert.doesNotMatch(otpStoreSrc, /restUrl\("platform_settings"/);
assert.doesNotMatch(otpStoreSrc, /settingsOtpId/);
assert.match(otpStoreSrc, /commitOtpAfterSuccessfulSend/);
assert.match(otpStoreSrc, /recordOtpSendFailure/);
assert.match(otpStoreSrc, /assertResendCooldown/);
assert.match(otpStoreSrc, /provider_message_id/);
assert.match(otpStoreSrc, /delivery_status/);
assert.doesNotMatch(otpStoreSrc, /__mcjForgotResets/);

// Auth: send-then-commit; DB cooldown; production hard-blocks debug OTP
assert.match(authSrc, /commitForgotOtpAfterSend|commitOtpAfterSuccessfulSend/);
assert.match(authSrc, /recordOtpSendFailure/);
assert.match(authSrc, /assertResendCooldown/);
assert.match(authSrc, /if \(String\(process\.env\.VERCEL_ENV \|\| ""\)\.toLowerCase\(\) === "production"\) return false;/);
assert.match(authSrc, /retryAfterSec: otpRetryAfterSec\(\)/);
assert.doesNotMatch(authSrc, /__mcjOtpCooldown/);
assert.doesNotMatch(authSrc, /await storeForgotOtp\([\s\S]{0,220}await sendEmailOtp/);
assert.doesNotMatch(authSrc, /restUrl\("platform_settings"/);

// Migration + pending-prod review markers
assert.match(mig, /password_reset_requests/);
assert.match(mig, /provider_message_id/);
assert.match(mig, /delivery_status/);
assert.match(pending, /DRAFT FOR REVIEW ONLY/i);
assert.match(pending, /DO NOT APPLY TO PRODUCTION/i);

// Frontend sessionStorage cooldown
assert.match(forgotSrc, /sessionStorage/);
assert.match(forgotSrc, /retryAfterSec/);
assert.match(roleGatesSrc, /sessionStorage|MCJOtpCooldown/);
assert.match(roleGatesSrc, /retryAfterSec/);

// otp-cooldown helper exists
assert.ok(readFileSync("src/otp-cooldown.js", "utf8").includes("sessionStorage"));

console.log("verify-otp-fix-offline: ok");
