#!/usr/bin/env node
/**
 * Offline verification for companion pricing P1 (no network / no DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";
import { isPricingV2Enabled } from "../server/api/_feature-flags.js";
import {
  normalizeLevelRow,
  validateLevelConfig,
  DEFAULT_LEVELS,
} from "../server/api/_companion-levels-store.js";
import { priceForGame } from "../server/api/_game-prices.js";

// --- Flag scaffolding ---
assert.equal(isPricingV2Enabled({}), false);
assert.equal(isPricingV2Enabled({ PRICE_V2: "1" }), true);
assert.equal(isPricingV2Enabled({ PRICING_V2: "true" }), true);
assert.equal(isPricingV2Enabled({ PRICE_V2: "0" }), false);

// --- Levels store: basePrice SoT ---
for (const row of DEFAULT_LEVELS) {
  const n = normalizeLevelRow(row);
  assert.ok(n.basePrice > 0, `${n.code} basePrice`);
  assert.equal(n.basePrice, row.basePrice);
  const checked = validateLevelConfig(n);
  assert.equal(checked.ok, true, checked.message);
}
assert.equal(validateLevelConfig({ ...DEFAULT_LEVELS[0], basePrice: 0 }).ok, false);
assert.equal(normalizeLevelRow({ level: 1, min: 20, max: 30 }).basePrice, 20);

// --- Resolver: approved row wins; ignores proposed_price ---
{
  const companion = { price: 99, game_prices: { VALORANT: 88 } };
  const level = { id: "lv2", basePrice: 30, min: 30, max: 40 };
  const rows = [
    {
      id: "svc-1",
      service_id: "sid-v",
      service_name: "VALORANT",
      price: 42,
      proposed_price: 999,
      enabled: true,
      review_status: "approved",
      source: "companion_custom",
    },
  ];
  const r = resolveEffectiveServicePrice({
    companion,
    serviceId: "sid-v",
    gameName: "VALORANT",
    level,
    serviceRows: rows,
  });
  assert.equal(r.price, 42);
  assert.equal(r.source, "companion_custom");
  assert.notEqual(r.price, 999);
}

// --- Resolver: pending-only row does not win; proposed ignored ---
{
  const companion = { price: 55, game_prices: { APEX: 55 } };
  const rows = [
    {
      id: "svc-p",
      service_name: "APEX",
      price: 55,
      proposed_price: 120,
      enabled: true,
      review_status: "pending",
      source: "companion_custom",
    },
  ];
  const r = resolveEffectiveServicePrice({
    companion,
    gameName: "APEX",
    level: { id: "lv1", basePrice: 20 },
    serviceRows: rows,
    env: {},
  });
  assert.equal(r.price, 55);
  assert.equal(r.source, "legacy_profile");
}

// --- P1 default (PRICE_V2 off): no service row → legacy equals priceForGame ---
{
  const companion = { price: 18, game_prices: { CS2: 27 } };
  const legacy = priceForGame(companion, "CS2", "");
  const r = resolveEffectiveServicePrice({
    companion,
    gameName: "CS2",
    level: { id: "lv3", basePrice: 40 },
    serviceRows: [],
    env: { PRICE_V2: "0" },
  });
  assert.equal(r.price, legacy);
  assert.equal(r.price, 27);
  assert.equal(r.source, "legacy_profile");
}

// --- PRICE_V2 on: level base before legacy ---
{
  const companion = { price: 18, game_prices: { CS2: 27 } };
  const r = resolveEffectiveServicePrice({
    companion,
    gameName: "CS2",
    level: { id: "lv3", basePrice: 40 },
    serviceRows: [],
    env: { PRICE_V2: "1" },
  });
  assert.equal(r.price, 40);
  assert.equal(r.source, "level_base_price");
}

// --- No legacy → level base even when V2 off ---
{
  const r = resolveEffectiveServicePrice({
    companion: { price: 0, game_prices: {} },
    gameName: "VALORANT",
    level: { id: "lv1", base_price: 20 },
    serviceRows: [],
    env: {},
  });
  assert.equal(r.price, 20);
  assert.equal(r.source, "level_base_price");
}

// --- Migration SQL present ---
const mig = readFileSync("supabase/migrations/20260908_companion_pricing_p1.sql", "utf8");
assert.match(mig, /base_price/);
assert.match(mig, /proposed_price/);
assert.match(mig, /legacy_import|source/);
const pending = readFileSync(
  "supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql",
  "utf8"
);
assert.match(pending, /DRAFT FOR REVIEW ONLY/i);
assert.match(pending, /DO NOT APPLY TO PRODUCTION/i);

console.log("verify-pricing-p1-offline: ok");
