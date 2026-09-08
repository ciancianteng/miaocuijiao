#!/usr/bin/env node
/**
 * Offline P1 pricing contract (no Staging/Prod DB).
 * Usage: node scripts/verify-pricing-p1-offline.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveEffectiveServicePrice,
  applyLevelBasePriceToServices,
  shouldFollowLevelBasePrice,
} from "../server/api/_resolve-effective-service-price.js";
import { normalizeLevelRow, validateLevelConfig } from "../server/api/_companion-levels-store.js";
import { isPricingV2Enabled } from "../server/api/_feature-flags.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}
function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function testPriority() {
  const level = { id: "lv2", basePrice: 30 };
  const companion = { price: 99, game_prices: { 英雄联盟: 88 } };

  // pending proposed must NOT win
  const pending = resolveEffectiveServicePrice({
    companion,
    level,
    gameName: "英雄联盟",
    services: [
      {
        id: "s1",
        service_name: "英雄联盟",
        price: 35,
        proposed_price: 50,
        enabled: true,
        review_status: "approved",
        source: "companion_custom",
      },
    ],
  });
  if (pending.price !== 35) fail(`pending must not affect effective; got ${pending.price}`);
  if (!pending.ignoredProposedPrice) fail("expected ignoredProposedPrice");
  pass("pending proposed_price ignored; approved custom 35 wins");

  // level base when no service row
  const baseOnly = resolveEffectiveServicePrice({
    companion: { price: 0 },
    level,
    gameName: "APEX",
    services: [],
  });
  if (baseOnly.price !== 30 || baseOnly.source !== "level_base_price") {
    fail(`expected level base 30, got ${JSON.stringify(baseOnly)}`);
  }
  pass("level base_price used when no service row");

  // legacy fallback
  const legacy = resolveEffectiveServicePrice({
    companion,
    level: null,
    gameName: "英雄联盟",
    services: [],
    allowLegacy: true,
  });
  if (legacy.price !== 88 || legacy.source !== "legacy_profile") {
    fail(`expected legacy 88, got ${JSON.stringify(legacy)}`);
  }
  pass("legacy fallback to game_prices");

  // no legacy when disabled
  const none = resolveEffectiveServicePrice({
    companion,
    level: null,
    services: [],
    allowLegacy: false,
  });
  if (none.ok) fail("allowLegacy=false should fail without service/level");
  pass("allowLegacy=false fails closed without service/level");
}

function testLevelChangeKeepCustom() {
  const level = { id: "lv3", basePrice: 45 };
  const rows = [
    { id: "a", source: "companion_custom", price: 40, enabled: true, review_status: "approved" },
    { id: "b", source: "level_default", price: 30, enabled: true, review_status: "approved" },
    { id: "c", source: "legacy_import", price: 25, enabled: true, review_status: "approved" },
  ];
  if (shouldFollowLevelBasePrice(rows[0])) fail("custom must not follow base");
  if (!shouldFollowLevelBasePrice(rows[1])) fail("level_default must follow");
  const next = applyLevelBasePriceToServices(rows, level);
  if (next[0].price !== 40 || next[0].followedBase) fail("custom overwritten");
  if (next[1].price !== 45 || !next[1].followedBase) fail("level_default not updated");
  if (next[2].price !== 45) fail("legacy_import should follow until customized");
  pass("level change keeps approved custom; others follow base_price");
}

function testBasePriceValidation() {
  const ok = validateLevelConfig({ code: "Lv1", name: "萌喵", color: "#9CA3AF", displayColor: "#9CA3AF", badgeBorder: "#9CA3AF", badgeText: "#fff", badgeIcon: "#9CA3AF", min: 20, max: 30, basePrice: 20, commissionRate: 20 });
  if (!ok.ok) fail(ok.message);
  const row = normalizeLevelRow({ min: 20, max: 30 });
  if (!(row.basePrice > 0)) fail("normalize should default basePrice from min/fallback");
  pass("base_price validation + normalize default");
}

function testFlagDefaultOff() {
  if (isPricingV2Enabled({})) fail("PRICE_V2 must default off");
  if (!isPricingV2Enabled({ PRICE_V2: "1" })) fail("PRICE_V2=1 should enable");
  if (!isPricingV2Enabled({ PRICING_V2: "true" })) fail("PRICING_V2 alias should enable");
  pass("PRICE_V2 / PRICING_V2 flag defaults off; aliases work");
}

function testSqlAndOrdersWired() {
  const mig = read("supabase/migrations/20260908_companion_pricing_p1.sql");
  if (!/base_price/.test(mig) || !/proposed_price/.test(mig)) fail("migration missing columns");
  const pending = read("supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql");
  if (!/DRAFT FOR REVIEW ONLY/.test(pending)) fail("pending-prod must be review-only");
  if (!/DO NOT APPLY TO PRODUCTION/.test(pending)) fail("pending-prod missing prod ban");
  const orders = read("server/api/orders.js");
  if (!/resolveEffectiveServicePrice/.test(orders)) fail("orders.js not wired to resolver");
  const admin = read("src/admin-companion-levels.js");
  if (!/name="basePrice"/.test(admin)) fail("admin levels UI missing basePrice field");
  pass("SQL + orders wiring + admin basePrice UI present");
}

function main() {
  console.log("=== pricing P1 offline verify ===");
  testPriority();
  testLevelChangeKeepCustom();
  testBasePriceValidation();
  testFlagDefaultOff();
  testSqlAndOrdersWired();
  console.log("\n[OK] P1 offline contract PASS — no production migration executed");
}

main();
