#!/usr/bin/env node
/**
 * Multi-order availability SoT + draft persistence regressions.
 * Hall / single-order / multi-add must share canCompanionAcceptBossOrder.
 * No network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { canCompanionAcceptBossOrder, availabilityCode } from "../server/api/_companion-public-map.js";
import { placeMultiOrder } from "../server/api/_place-multi-order.js";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";
import { priceForGame } from "../server/api/_game-prices.js";

const presenceSrc = readFileSync(new URL("../src/companion-presence.js", import.meta.url), "utf8");
const teamSrc = readFileSync(new URL("../src/multi-companion-team.js", import.meta.url), "utf8");
const hallSrc = readFileSync(new URL("../src/companion-hall.js", import.meta.url), "utf8");
const modalSrc = readFileSync(new URL("../src/place-order-modal.js", import.meta.url), "utf8");
const ordersSrc = readFileSync(new URL("../server/api/orders.js", import.meta.url), "utf8");
const profileSrc = readFileSync(new URL("../src/profile-detail.js", import.meta.url), "utf8");

const sandbox = { window: {}, globalThis: {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.runInNewContext(presenceSrc, sandbox);
const Presence = sandbox.MCJCompanionPresence;
assert.ok(Presence, "MCJCompanionPresence missing");

function row(status) {
  return { availability_status: status, online_status: status };
}

// CASE 1 — hall online + single-order allowed => multi add allowed
{
  assert.equal(canCompanionAcceptBossOrder(row("online")), true);
  assert.equal(Presence.canAcceptBossOrder({ availabilityStatus: "online" }), true);
  assert.equal(Presence.fromCompanion({ availabilityStatus: "online" }).canAcceptBossOrder, true);
  // Busy is still orderable for boss (matches assertCompanionOrderable).
  assert.equal(canCompanionAcceptBossOrder(row("busy")), true);
  assert.equal(Presence.canAcceptBossOrder({ availabilityStatus: "busy" }), true);
  assert.equal(Presence.canAcceptBossOrder({ status: "忙碌中" }), true);
}

// CASE 7 — paused / offline blocked on every surface
{
  assert.equal(canCompanionAcceptBossOrder(row("paused")), false);
  assert.equal(canCompanionAcceptBossOrder(row("offline")), false);
  assert.equal(Presence.canAcceptBossOrder({ availabilityStatus: "paused" }), false);
  assert.equal(Presence.canAcceptBossOrder({ availabilityStatus: "offline" }), false);
  assert.equal(Presence.unavailableReason({ availabilityStatus: "paused" }).includes("暂停"), true);
  assert.equal(Presence.unavailableReason({ availabilityStatus: "offline" }).includes("离线"), true);
}

// Hall "在线可接单" must not be classified unavailable via 不可接 substring
{
  const p = Presence.fromCompanion({ statusText: "在线可接单", availabilityStatus: "online" });
  assert.equal(p.code, "online");
  assert.equal(p.canAcceptBossOrder, true);
  assert.equal(Presence.canAcceptBossOrder({ status: "在线可接单" }), true);
}

// 不可接单 must not collapse to online via 可接单 substring
{
  const p = Presence.fromCompanion({ availabilityText: "暂不可接单" });
  assert.notEqual(p.code, "online");
  assert.equal(p.canAcceptBossOrder, false);
}

// Hall online="1" with explicit online status stays orderable
{
  assert.equal(
    Presence.canAcceptBossOrder({
      availabilityStatus: "online",
      statusText: "在线可接单",
      online: "1",
    }),
    true
  );
}

// Server SoT used by both place_order and place_multi_order
{
  assert.match(ordersSrc, /canCompanionAcceptBossOrder/);
  assert.match(ordersSrc, /assertCompanionOrderable/);
  assert.match(readFileSync(new URL("../server/api/_place-multi-order.js", import.meta.url), "utf8"), /assertCompanionOrderable/);
}

// Multi client must use presence SoT — not a private busy regex
{
  assert.match(teamSrc, /MCJCompanionPresence/);
  assert.match(teamSrc, /canAcceptBossOrder/);
  assert.doesNotMatch(teamSrc, /offline\|离线\|休息\|不可接\|unavailable\|busy/);
  assert.match(teamSrc, /function continueToHall/);
  assert.match(teamSrc, /persist\(\);\s*\n\s*renderBar\(\);/);
  assert.match(teamSrc, /Draft stays in sessionStorage/);
  assert.match(teamSrc, /已加入一起下单/);
  assert.match(teamSrc, /availabilityCheckedAt/);
}

// 立即下单 and 加入一起下单 stay separate
{
  assert.match(modalSrc, /function addAnotherCompanion/);
  assert.match(modalSrc, /function submitOrder/);
  assert.match(modalSrc, /data-po-add-another/);
  assert.match(modalSrc, /data-po-submit/);
  assert.match(hallSrc, /data-hall-team-add/);
  assert.match(hallSrc, /data-hall-order/);
  assert.match(hallSrc, /canAcceptBossOrder/);
  assert.match(profileSrc, /requireServicePick:\s*true/);
}

// CASE 2 / 9 / 10 — continue + restore keep draft
{
  assert.match(teamSrc, /mcjMultiTeamSelection/);
  assert.match(teamSrc, /mcjMultiTeamPicking/);
  assert.doesNotMatch(
    teamSrc.slice(teamSrc.indexOf("function continueToHall"), teamSrc.indexOf("function continueToHall") + 420),
    /clearTeam\(\);/
  );
  assert.match(teamSrc, /priceSnapshot/);
}

// CASE 8 — duplicate companion blocked
{
  assert.match(teamSrc, /alreadyInTeam:\s*true/);
}

// CASE 3/4/5/6 — 35+40=75, create does not debit
{
  const companion = {
    user_id: "a",
    price: 30,
    game_prices: { "三角洲 手游 国服": 35, 王者荣耀: 40 },
  };
  const rows = [
    { id: "r35", service_name: "三角洲 手游 国服", price: 35, source: "admin_set", enabled: true, review_status: "approved" },
    { id: "r40", service_name: "王者荣耀", price: 40, source: "admin_set", enabled: true, review_status: "approved" },
  ];
  const a = resolveEffectiveServicePrice({
    companion,
    gameName: "三角洲手游 国服",
    serviceRows: rows,
    level: { base_price: 30 },
  });
  const b = resolveEffectiveServicePrice({
    companion,
    gameName: "王者荣耀",
    serviceRows: rows,
    level: { base_price: 30 },
  });
  assert.equal(a.price, 35);
  assert.equal(b.price, 40);
  assert.equal(a.price + b.price, 75);
  assert.equal(priceForGame(companion, "三角洲手游 国服"), 35);
}

{
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orders = [];
  const debits = [];
  let seq = 0;
  async function supabaseJson(url, opts = {}) {
    const method = String(opts.method || "GET").toUpperCase();
    if (method === "GET") return [];
    if (method === "POST") {
      const row = JSON.parse(opts.body);
      row.id = `ord-${++seq}`;
      orders.push(row);
      return [row];
    }
    if (method === "PATCH") return [];
    return [];
  }
  const result = await placeMultiOrder({
    profile: { id: "boss-test" },
    body: {
      idempotencyKey: "avail-75",
      gameId: "gid",
      paymentMethod: "catfood",
      companions: [
        {
          companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          companionName: "A",
          service: "三角洲 手游 国服",
          hours: 1,
          unitPrice: 35,
          totalAmount: 35,
          gameId: "gid",
        },
        {
          companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          companionName: "B",
          service: "王者荣耀",
          hours: 1,
          unitPrice: 40,
          totalAmount: 40,
          gameId: "gid",
        },
      ],
    },
    deps: {
      restUrl: (t, q = "") => `${t}${q}`,
      supabaseJson,
      serviceHeaders: () => ({}),
      nextOrderNo: async () => `NO${++seq}`,
      resolveCompanionUserId: async (id) => id,
      assertCompanionOrderable: async (id) => ({
        ok: true,
        cp: { user_id: id, display_name: id, availability_status: "online" },
      }),
      priceForGame: () => 0,
      assertNotSelfTrade: () => {},
      assertOrderPaymentMethodAllowed: async (code) => ({ ok: true, code: code || "catfood" }),
      isWalletMethod: (m) => String(m).toLowerCase() === "catfood",
      debitWallet: async (args) => {
        debits.push(args);
      },
      viewOrder: (o) => o,
      addSystemMessage: async () => {},
      resolveOrderUnitPrice: async ({ gameName }) => {
        if (String(gameName).includes("三角洲")) {
          return { price: 35, source: "admin_set", serviceRow: { id: "r35", service_name: "三角洲 手游 国服" } };
        }
        return { price: 40, source: "admin_set", serviceRow: { id: "r40", service_name: "王者荣耀" } };
      },
    },
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.groupTotal, 75);
  assert.equal(result.walletDebited, false);
  assert.equal(debits.length, 0);
  assert.equal(result.next, "payment-confirm");
  const children = orders.filter((o) => o.parent_order_id);
  assert.equal(children.length, 2);
  assert.equal(Number(children[0].total_amount), 35);
  assert.equal(Number(children[1].total_amount), 40);
  assert.equal(Number(orders[0].total_amount), 75);
  assert.equal(availabilityCode(row("online")), "online");
}

console.log("verify-multi-order-availability: PASS");
