#!/usr/bin/env node
/**
 * Offline verify: admin companion review must soft-skip missing companion_services.
 * Production SoT = companion_profiles.price / game_prices (no CREATE TABLE in this fix).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLevelDefaultServiceSeeds,
  buildProfilesPricingPatchFromLevel,
  seedCompanionServicesFromLevel,
} from "../server/api/_companion-services-seed.js";
import { isMissingRelation } from "../server/api/_companion-media-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

{
  const err = Object.assign(
    new Error("Could not find the table 'public.companion_services' in the schema cache"),
    {
      status: 404,
      body: {
        code: "PGRST205",
        message: "Could not find the table 'public.companion_services' in the schema cache",
      },
    }
  );
  assert.equal(isMissingRelation(err), true);
}

{
  const companion = {
    user_id: "u-soft",
    game: "VALORANT,APEX",
    game_prices: { VALORANT: 18 },
  };
  const level = { id: "lv2", base_price: 22, name: "Lv2" };
  const seeds = buildLevelDefaultServiceSeeds(companion, level);
  assert.ok(seeds.length >= 2);
  const patch = buildProfilesPricingPatchFromLevel(companion, level, seeds);
  assert.equal(patch.price, 22);
  assert.equal(patch.game_prices.VALORANT, 18);
  assert.equal(patch.game_prices.APEX, 22);
}

{
  const seed = read("server/api/_companion-services-seed.js");
  assert.match(seed, /isMissingRelation\(e\)/);
  assert.match(seed, /skippedTable:\s*true/);
  assert.match(seed, /mode:\s*"companion_profiles"/);
  assert.doesNotMatch(
    seed.slice(0, seed.indexOf("SERVICES_SEED_READ_FAILED")),
    /throw err;\s*\n\s*\}\s*\n\s*\n\s*const written/
  );

  const players = read("server/api/admin/players.js");
  assert.match(players, /seedResult\?\.profilesPatch/);
  assert.match(players, /skippedTable/);
  assert.match(players, /game_prices:\s*seedProfilesPatch\.game_prices|seedResult\?\.profilesPatch\?\.game_prices/);

  const detail = read("src/admin-player-detail.js");
  assert.doesNotMatch(detail, /初始化 companion_services/);
  assert.match(detail, /写入陪玩资料价格/);

  const marketplace = read("server/api/boss/marketplace.js");
  assert.match(marketplace, /isMissingRelation/);
  assert.match(marketplace, /servicesFromGamePrices/);
}

// Runtime soft-skip: mock PostgREST missing-table response.
{
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url || "");
    if (u.includes("/rest/v1/companion_services")) {
      return {
        ok: false,
        status: 404,
        async text() {
          return JSON.stringify({
            code: "PGRST205",
            message: "Could not find the table 'public.companion_services' in the schema cache",
          });
        },
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const result = await seedCompanionServicesFromLevel(
      { user_id: "u-soft", game: "VALORANT,APEX", game_prices: { VALORANT: 18 } },
      { id: "lv2", basePrice: 22, name: "Lv2" }
    );
    assert.equal(result.skippedTable, true);
    assert.equal(result.mode, "companion_profiles");
    assert.equal(result.profilesPatch.price, 22);
    assert.equal(result.profilesPatch.game_prices.VALORANT, 18);
    assert.equal(result.profilesPatch.game_prices.APEX, 22);
    assert.equal(result.written.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("verify-admin-companion-services-soft-skip: PASS");
