#!/usr/bin/env node
/**
 * Offline verification for Pricing V2 P2:
 * - apply submit must not require / persist applicant price
 * - approve requires level + seeds companion_services from level.base_price
 * - no silent Lv1 fallback on approveListingPatchForRow
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approveListingPatchForRow } from "../server/api/_companion-listing-sync.js";
import {
  buildLevelDefaultServiceSeeds,
  derivedListingPriceFromLevel,
} from "../server/api/_companion-services-seed.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

// --- Seed builder uses level.base_price only ---
{
  const companion = {
    user_id: "user-1",
    game: "VALORANT,和平精英",
    service_ids: [],
  };
  const level = { id: "lv2", basePrice: 30, name: "Lv2" };
  const seeds = buildLevelDefaultServiceSeeds(companion, level);
  assert.ok(seeds.length >= 2, "seeds from games");
  for (const seed of seeds) {
    assert.equal(seed.price, 30);
    assert.equal(seed.source, "level_default");
    assert.equal(seed.base_price_snapshot, 30);
    assert.equal(seed.level_id_at_price, "lv2");
    assert.equal(seed.review_status, "approved");
    assert.equal(seed.companion_id, "user-1");
  }
  assert.equal(derivedListingPriceFromLevel(level), 30);
  assert.equal(derivedListingPriceFromLevel({ base_price: 18 }), 18);
  assert.deepEqual(buildLevelDefaultServiceSeeds(companion, { id: "lv1", basePrice: 0 }), []);
}

// --- Approve listing patch must NOT inject silent Lv1 ---
{
  const patch = approveListingPatchForRow(
    { id: "c1", application_status: "pending" },
    { level_id: "lv3", level_name: "Lv3", price: 40 }
  );
  assert.equal(patch.level_id, "lv3");
  assert.equal(patch.price, 40);
  assert.equal(patch.application_status, "approved");

  const noLevel = approveListingPatchForRow({ id: "c2" }, { price: 20 });
  assert.equal(noLevel.level_id, undefined);
  assert.notEqual(noLevel.level_id, "lv1");
}

// --- Source guards: apply UI / API / admin must encode P2 rules ---
{
  const apply = read("src/companion-application.js");
  assert.match(apply, /var steps = \[\s*"基本资料"/);
  assert.equal((apply.match(/接单价格（必填）/g) || []).length, 0);
  assert.equal((apply.match(/data-game-price/g) || []).length, 0);
  assert.match(apply, /Pricing V2 P2: never submit applicant price fields/);
  assert.doesNotMatch(apply, /price:\s*draft\.data\.hourlyPrice/);
  assert.doesNotMatch(apply, /game_prices:\s*draft\.data\.gamePriceMap/);

  const companionApi = read("server/api/companion.js");
  assert.match(companionApi, /Pricing V2 P2: applicant must NOT set sell price/);
  const submitStart = companionApi.indexOf('if (action === "submit_application")');
  const submitChunk = companionApi.slice(submitStart, submitStart + 2500);
  assert.doesNotMatch(submitChunk, /assertHasPositivePrice\(body/);

  const players = read("server/api/admin/players.js");
  assert.match(players, /APPROVE_MISSING_LEVEL_MESSAGE/);
  assert.match(players, /seedCompanionServicesFromLevel/);
  assert.match(players, /MISSING_LEVEL/);
  assert.doesNotMatch(players, /assertHasPositivePrice\(payload, companion/);

  const listing = read("server/api/_companion-listing-sync.js");
  assert.match(listing, /do NOT silently fall back to Lv1/);
  const approveStart = listing.indexOf("export function approveListingPatchForRow");
  const approveChunk = listing.slice(approveStart, approveStart + 500);
  assert.doesNotMatch(approveChunk, /ensureDefaultLevelPatch\(row\)/);

  const adminApps = read("src/admin-companion-applications.js");
  assert.match(adminApps, /data-capp-level/);
  assert.match(adminApps, /请先选择陪玩等级/);
  assert.match(adminApps, /levelId/);

  const adminDetail = read("src/admin-player-detail.js");
  assert.match(adminDetail, /必须选择陪玩等级/);
  assert.match(adminDetail, /levelPricePreviewHtml|base_price/);
  assert.match(adminDetail, /payload\.levelId/);
}

console.log("pricing-v2-p2 offline checks passed");
