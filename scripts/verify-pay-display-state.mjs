import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyPlatformPayInfo, loadErrorPayInfo, PAY_INFO_RETRY } from "../server/api/_platform-pay-qr.js";

const client = fs.readFileSync(new URL("../src/payment-confirm.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../payment-confirm.html", import.meta.url), "utf8");

assert.equal(classifyPlatformPayInfo(null), "loading");
assert.equal(classifyPlatformPayInfo({ __live: true, payState: "enabled", enabled: true, qrUrl: "https://cdn.example/qr.png" }), "enabled");
assert.equal(
  classifyPlatformPayInfo({ __live: true, payState: "disabled", enabled: false, unavailable: true, source: "unavailable" }),
  "disabled"
);
const failed = loadErrorPayInfo("duitnow");
assert.equal(failed.payState, "error");
assert.equal(failed.source, "error");
assert.equal(failed.enabled, null);
assert.equal(failed.instructions, PAY_INFO_RETRY);
assert.equal(classifyPlatformPayInfo(failed), "error");
assert.equal(failed.instructions.includes("暂未开放"), false);
assert.equal(classifyPlatformPayInfo({ source: "error", enabled: false, instructions: "DuitNow 暂未开放" }), "error");

assert.equal(client.includes("if (abortCtrl) abortCtrl.abort()"), false);
assert.equal(client.includes(PAY_INFO_RETRY), true);
assert.equal(client.includes('data-pay-loading="1"'), true);
assert.equal(client.includes("enabled: false"), false);
assert.equal(page.includes("20261029pay2"), true);
assert.equal(page.includes("min(88vw"), false);

console.log("verify-pay-display-state: PASS");
