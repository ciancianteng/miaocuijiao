#!/usr/bin/env node
/**
 * Offline accept checks for Admin settings production-risk guards.
 * Does not hit staging; validates pure merge / clamp logic mirrors.
 */
import assert from "node:assert/strict";

function mergePaymentChannelsPublic(currentMap, incoming) {
  const curMap = currentMap && typeof currentMap === "object" ? currentMap : {};
  const merged = { ...curMap };
  for (const [channelId, cfg] of Object.entries(incoming || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    const prev = curMap[channelId] && typeof curMap[channelId] === "object" ? curMap[channelId] : {};
    const nextCfg = { ...prev, ...cfg };
    if (cfg.manual && typeof cfg.manual === "object") {
      nextCfg.manual = {
        ...(prev.manual && typeof prev.manual === "object" ? prev.manual : {}),
        ...cfg.manual,
      };
    }
    merged[channelId] = nextCfg;
  }
  return merged;
}

function clampCommission(rateRaw) {
  if (!Number.isFinite(rateRaw)) throw new Error("抽成比例必须是数字");
  if (rateRaw < 0 || rateRaw > 100) throw new Error("抽成比例须在 0–100 之间");
  return Math.round(rateRaw * 100) / 100;
}

function capRefund(requested, maxCredit) {
  if (requested <= 0) throw new Error("退款猫粮必须大于 0。");
  if (maxCredit > 0 && requested > maxCredit + 0.001) {
    throw new Error(`退款猫粮不能超过申请金额（最多 ${maxCredit}）。`);
  }
  return maxCredit > 0 ? Math.min(requested, maxCredit) : requested;
}

// 1) Partial payment channel save must not wipe siblings
const merged = mergePaymentChannelsPublic(
  {
    duitnow: { enabled: true, qrUrl: "https://a/qr.png" },
    tng: { enabled: false, manual: { phone: "6012" } },
  },
  { tng: { enabled: true, manual: { receiverName: "Ali" } } }
);
assert.equal(merged.duitnow.enabled, true);
assert.equal(merged.duitnow.qrUrl, "https://a/qr.png");
assert.equal(merged.tng.enabled, true);
assert.equal(merged.tng.manual.phone, "6012");
assert.equal(merged.tng.manual.receiverName, "Ali");

// 2) Commission clamp
assert.equal(clampCommission(20), 20);
assert.throws(() => clampCommission(120));
assert.throws(() => clampCommission(-1));

// 3) Refund cap
assert.equal(capRefund(50, 50), 50);
assert.throws(() => capRefund(80, 50));
assert.equal(capRefund(30, 50), 30);

console.log("ADMIN_SETTINGS_RISK_ACCEPT_PASS");
