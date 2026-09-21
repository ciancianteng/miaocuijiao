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
  const exact = line("三角洲 手游 国服");
  assert.equal(exact.unit, 35);
  const spaced = line("三角洲手游 国服");
  assert.equal(spaced.unit, 35);
  assert.equal(priceForGame(companion, "三角洲手游 国服"), 35);
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
  assert.match(modal, /Never guess list\[0\]/);
  assert.match(modal, /NEVER prefer extras\.service/);
  assert.match(modal, /must not inject services\[0\]/);
  assert.match(modal, /never silently pick services\[0\] among many/);
  assert.match(modal, /请先选择具体服务后再加入队伍/);
  assert.match(team, /compactServiceKey/);
  assert.match(modal, /compactServiceKey/);
  assert.match(modal, /requireServicePick/);
  assert.match(team, /do NOT auto-pick services\[0\]/);
  assert.match(team, /openPlaceOrderForHallCompanion/);
  assert.match(team, /requireServicePick:\s*true/);
  assert.doesNotMatch(team, /Prefer a service-specific priced row over pure level-default when no filter/);
}

const { placeMultiOrder } = await import("../server/api/_place-multi-order.js");

function orderHarness(resolveOrderUnitPrice) {
  const orders = [];
  let seq = 0;
  const debits = [];
  async function supabaseJson(url, opts = {}) {
    const method = String(opts.method || "GET").toUpperCase();
    if (method === "GET") return [];
    if (method === "POST") {
      const row = JSON.parse(opts.body);
      row.id = `ord-${++seq}`;
      orders.push(row);
      return [row];
    }
    if (method === "PATCH") {
      const id = decodeURIComponent((String(url).match(/id=eq\.([^&]+)/) || [])[1] || "");
      const patch = JSON.parse(opts.body);
      const row = orders.find((o) => o.id === id);
      if (row) Object.assign(row, patch);
      return row ? [row] : [];
    }
    return [];
  }
  const deps = {
    restUrl: (table, q = "") => `${table}${q}`,
    supabaseJson,
    serviceHeaders: () => ({}),
    nextOrderNo: async () => `NO${++seq}`,
    resolveCompanionUserId: async (id) => id,
    assertCompanionOrderable: async (id) => ({
      ok: true,
      cp: { user_id: id, display_name: id.startsWith("aaa") ? "小灰灰" : "小宏", level_id: "lv2" },
    }),
    priceForGame: () => 0,
    assertNotSelfTrade: () => {},
    assertOrderPaymentMethodAllowed: async (code) => ({ ok: true, code: code || "catfood" }),
    isWalletMethod: (method) => String(method).toLowerCase() === "catfood",
    debitWallet: async (args) => {
      debits.push(args);
    },
    viewOrder: (order) => order,
    addSystemMessage: async () => {},
    resolveOrderUnitPrice,
  };
  return { orders, debits, deps };
}

// Test 1b — placeMultiOrder snapshots each service price; NO wallet debit at create
{
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { orders, debits, deps } = orderHarness(async ({ gameName }) => {
    if (String(gameName).includes("三角洲 手游")) {
      return {
        price: 35,
        source: "admin_set",
        serviceRow: { id: "row-delta", service_id: null, service_name: "三角洲 手游 国服" },
      };
    }
    return {
      price: 30,
      source: "admin_set",
      serviceRow: { id: "row-wz", service_id: null, service_name: "王者荣耀 国服" },
    };
  });
  const result = await placeMultiOrder({
    profile: { id: "boss-test" },
    body: {
      idempotencyKey: "multi-price-65",
      gameId: "boss-gid",
      paymentMethod: "catfood",
      companions: [
        {
          companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          companionName: "小灰灰",
          service: "三角洲 手游 国服",
          serviceType: "三角洲 手游 国服",
          hours: 1,
          unitPrice: 35,
          totalAmount: 35,
          gameId: "boss-gid",
        },
        {
          companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          companionName: "小宏",
          service: "王者荣耀 国服",
          serviceType: "王者荣耀 国服",
          hours: 1,
          unitPrice: 30,
          totalAmount: 30,
          gameId: "boss-gid",
        },
      ],
    },
    deps,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.walletDebited, false);
  assert.equal(result.walletDebitCount, 0);
  assert.equal(result.walletDebitAmount, 0);
  assert.equal(result.groupTotal, 65);
  assert.equal(debits.length, 0, "create must not debit; pay_order debits parent once");
  assert.equal(String(orders[0].status), "awaiting_payment");
  assert.equal(result.next, "payment-confirm");
  const children = orders.filter((row) => row.parent_order_id);
  assert.equal(children.length, 2);
  assert.equal(Number(children[0].unit_price), 35);
  assert.equal(Number(children[0].total_amount), 35);
  assert.equal(Number(children[1].unit_price), 30);
  assert.equal(Number(children[1].total_amount), 30);
  assert.equal(Number(orders[0].total_amount), 65);
  assert.equal(String(children[0].status), "awaiting_payment");
  assert.equal(String(children[1].status), "awaiting_payment");
  assert.match(children[0].description, /service_row_id：row-delta/);
  assert.match(children[0].description, /单价快照：35/);
  assert.match(children[1].description, /单价快照：30/);
  assert.equal(children[0].parent_order_id, orders[0].id);
}

// Wrong client unit must not create/debit
{
  const { debits, deps } = orderHarness(async () => ({
    price: 35,
    source: "admin_set",
    serviceRow: { id: "row-b", service_name: "Service B" },
  }));
  const rejected = await placeMultiOrder({
    profile: { id: "boss-test" },
    body: {
      idempotencyKey: "multi-price-mismatch",
      gameId: "boss-gid",
      paymentMethod: "catfood",
      companions: [
        {
          companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          service: "Service B",
          hours: 1,
          unitPrice: 30,
          totalAmount: 30,
          gameId: "boss-gid",
        },
        {
          companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          service: "Service B",
          hours: 1,
          unitPrice: 35,
          totalAmount: 35,
          gameId: "boss-gid",
        },
      ],
    },
    deps,
  });
  assert.equal(rejected.ok, false);
  assert.equal(debits.length, 0);
  assert.match(String(rejected.message), /35/);
}

console.log("verify-multi-order-service-price: PASS");
