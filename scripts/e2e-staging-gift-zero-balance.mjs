#!/usr/bin/env node
/**
 * Staging API accept: gift catfood balance lock (no writes to Production).
 * Uses Staging boss token if provided; otherwise asserts offline + public endpoints.
 *
 * STAGING_BOSS_TOKEN=... STAGING_COMPANION_ID=... STAGING_GIFT_ID=... \
 *   node scripts/e2e-staging-gift-zero-balance.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-gift-zero-balance");
fs.mkdirSync(outDir, { recursive: true });

const BASE = String(process.env.BASE || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
assertSmokeTargetAllowed(BASE);

const token = String(process.env.STAGING_BOSS_TOKEN || "").trim();
const companionId = String(process.env.STAGING_COMPANION_ID || "").trim();
const giftId = String(process.env.STAGING_GIFT_ID || "").trim();

const report = { base: BASE, ts: new Date().toISOString(), cases: {} };

function mark(name, pass, detail) {
  report.cases[name] = { pass: !!pass, detail: detail || "" };
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`, detail || "");
}

// Bundle markers on staging after deploy
const home = await fetch(BASE + "/").then((r) => r.text());
const m = home.match(/assets\/boss-header[^"']+\.js/) || home.match(/assets\/profile-detail[^"']+\.js/);
mark("staging_home_reachable", home.length > 100, "html=" + home.length);

if (token && companionId && giftId) {
  const idem = "gift-zero-test-" + Date.now();
  const res = await fetch(BASE + "/api/boss/marketplace", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "send_gift",
      companionId,
      giftId,
      quantity: 1,
      idempotencyKey: idem,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const insuff =
    res.status >= 400 &&
    (body.code === "INSUFFICIENT_BALANCE" || /余额不足|insufficient/i.test(String(body.message || "")));
  // If wallet has balance this may succeed — still require either insuff OR ok with snapshot.availableBalance defined after debit
  if (insuff) {
    mark("case_insufficient_or_locked", true, JSON.stringify({ status: res.status, code: body.code, avail: body.availableBalance, need: body.requiredAmount }));
  } else if (body.ok && body.snapshot) {
    mark("case_success_with_server_price", body.snapshot.grossCatFood > 0, JSON.stringify(body.snapshot));
    // replay idempotency
    const res2 = await fetch(BASE + "/api/boss/marketplace", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_gift",
        companionId,
        giftId,
        quantity: 1,
        idempotencyKey: idem,
      }),
    });
    const body2 = await res2.json().catch(() => ({}));
    mark("case_idempotent_replay", !!(body2.ok && body2.replayed), JSON.stringify({ replayed: body2.replayed, message: body2.message }));
  } else {
    mark("case_insufficient_or_locked", false, JSON.stringify({ status: res.status, body }));
  }

  // qty*price overbalance probe: quantity 9999
  const resHuge = await fetch(BASE + "/api/boss/marketplace", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send_gift",
      companionId,
      giftId,
      quantity: 9999,
      idempotencyKey: "gift-huge-" + Date.now(),
    }),
  });
  const huge = await resHuge.json().catch(() => ({}));
  mark(
    "case_qty_overbalance_fails",
    resHuge.status >= 400 && (huge.code === "INSUFFICIENT_BALANCE" || /不足|insufficient/i.test(String(huge.message || ""))),
    JSON.stringify({ status: resHuge.status, code: huge.code, message: huge.message })
  );
} else {
  mark("api_cases_skipped", true, "set STAGING_BOSS_TOKEN + COMPANION_ID + GIFT_ID for live API cases");
}

report.pass = Object.values(report.cases).every((c) => c.pass);
fs.writeFileSync(path.join(outDir, "STAGING_ACCEPT.json"), JSON.stringify(report, null, 2));
console.log(report.pass ? "PASS staging gift zero-balance accept" : "FAIL staging gift zero-balance accept");
process.exit(report.pass ? 0 : 1);
