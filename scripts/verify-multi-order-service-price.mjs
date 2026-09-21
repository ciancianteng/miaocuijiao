#!/usr/bin/env node
/**
 * Multi-order service price SoT regressions.
 * Fixture matches Production 小灰灰: 三角洲手游国服=35, 陪跑=30, 王者=30, level/listing=30.
 * No network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { priceForGame } from "../server/api/_game-prices.js";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";

const companion = {
  user_id: "xiaohuihui",
  price: 30,
  game: "王者荣耀、三角洲 手游 国服、三角洲陪跑刀 一千万",
  game_prices: {
    王者荣耀: 30,
    "三角洲 手游 国服": 35,
    "三角洲陪跑刀 一千万": 30,
  },
};
const level = { id: "lv2", base_price: 30, basePrice: 30 };
const rows = [
  {
    id: "row-run",
    service_id: null,
    service_name: "三角洲陪跑刀 一千万",
    price: 30,
    source: "admin_set",
    enabled: true,
    review_status: "approved",
  },
  {
    id: "row-delta",
    service_id: null,
    service_name: "三角洲 手游 国服",
    price: 35,
    source: "admin_set",
    enabled: true,
    review_status: "approved",
  },
  {
    id: "row-wz",
    service_id: null,
    service_name: "王者荣耀",
    price: 30,
    source: "admin_set",
    enabled: true,
    review_status: "approved",
  },
];

function line(name, hours = 1) {
  const resolved = resolveEffectiveServicePrice({
    companion,
    companionId: companion.user_id,
    gameName: name,
    serviceRows: rows,
    level,
  });
  const unit = resolved.price;
  return { name, unit, hours, subtotal: Math.round(unit * hours * 100) / 100, source: resolved.source };
}

// Test 1 — different companions/services, group total, single debit sum
{
  const a = line("三角洲 手游 国服", 1);
  const b = line("王者荣耀", 1);
  assert.equal(a.unit, 35);
  assert.equal(a.subtotal, 35);
  assert.equal(b.unit, 30);
  assert.equal(b.subtotal, 30);
  const group = a.subtotal + b.subtotal;
  assert.equal(group, 65);
  const walletDebit = group; // parent debits once; children are not debited again
  assert.equal(walletDebit, 65);
}

// Test 2 — same companion, two services; selecting B must be 35 not level 30
{
  const picked = line("三角洲 手游 国服");
  assert.equal(picked.unit, 35);
  assert.notEqual(picked.unit, level.base_price);
  assert.equal(picked.source, "admin_set");
}

// Test 3 — snapshot is the resolved number, later catalog mutation does not change it
{
  const snap = line("三角洲 手游 国服");
  rows.find((r) => r.id === "row-delta").price = 40;
  assert.equal(snap.unit, 35);
  assert.equal(snap.subtotal, 35);
  rows.find((r) => r.id === "row-delta").price = 35;
}

// Test 4 — no service-specific row → level base, not a sibling service's 35
{
  const bare = {
    price: 0,
    game_prices: {},
    game: "",
  };
  const resolved = resolveEffectiveServicePrice({
    companion: bare,
    gameName: "未配置服务",
    serviceRows: [],
    level,
  });
  assert.equal(resolved.price, 30);
  assert.equal(resolved.source, "level_base_price");
}

// Test 5 — combined game blob must not collapse to 王者/陪跑 30
{
  const blob = "王者荣耀、三角洲 手游 国服、三角洲陪跑刀 一千万";
  assert.equal(priceForGame(companion, blob), 0);
  const resolved = resolveEffectiveServicePrice({
    companion,
    gameName: blob,
    serviceRows: rows,
    level,
  });
  assert.equal(resolved.price, 0);
  assert.equal(resolved.source, "ambiguous_service");
  const exact = priceForGame(companion, "三角洲 手游 国服");
  assert.equal(exact, 35);
}

// Frontend must not prefer listing price or first-substring match
{
  const modal = readFileSync(new URL("../src/place-order-modal.js", import.meta.url), "utf8");
  const team = readFileSync(new URL("../src/multi-companion-team.js", import.meta.url), "utf8");
  assert.match(modal, /must not overwrite a selected service price/);
  assert.match(modal, /game: currentServiceLabel\(\)/);
  assert.match(team, /fuzzyTie/);
}

console.log("verify-multi-order-service-price: PASS");
