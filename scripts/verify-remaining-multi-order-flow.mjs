#!/usr/bin/env node
/**
 * Remaining multi-order / mobile / tutorial regressions (post-#279).
 * Does not re-test pricing SoT (covered by verify-multi-order-service-price.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { placeMultiOrder } from "../server/api/_place-multi-order.js";

const team = readFileSync(new URL("../src/multi-companion-team.js", import.meta.url), "utf8");
const teamCss = readFileSync(new URL("../src/multi-companion-team.css", import.meta.url), "utf8");
const profile = readFileSync(new URL("../src/profile-detail.js", import.meta.url), "utf8");
const modal = readFileSync(new URL("../src/place-order-modal.js", import.meta.url), "utf8");
const guideCfg = readFileSync(new URL("../src/guide-tutorial-config.js", import.meta.url), "utf8");
const placeMultiSrc = readFileSync(new URL("../server/api/_place-multi-order.js", import.meta.url), "utf8");

// Draft persistence + continue选
assert.match(team, /mcjMultiTeamSelection/);
assert.match(team, /mcjMultiTeamPicking/);
  assert.match(team, /persist\(\);\r?\n\s*renderBar\(\);/);
  assert.match(team, /Draft stays in sessionStorage/);
assert.match(team, /Only clearTeam\(\) wipes it/);
assert.match(team, /canKeepDraft/);
assert.match(team, /hasDraft/);
assert.doesNotMatch(
  team.slice(team.indexOf("function continueToHall"), team.indexOf("function continueToHall") + 280),
  /clearTeam\(\);/
);
assert.match(modal, /teamDraftShouldAbsorbCurrentCompanion/);
assert.match(modal, /absorbCurrentCompanionIntoTeam/);
assert.match(modal, /Existing multi draft/);
assert.match(modal, /已选 " \+ result.count \+ " 人，可继续选或确认并支付/);

// Sync skips hidden / zero-size bars
assert.match(team, /if \(el\.hidden\) continue/);
assert.match(team, /rect\.height > 0/);
assert.match(profile, /syncBottomStackOffset/);

// Hall padding when team bar present
assert.match(teamCss, /companion-hall-page/);
assert.match(readFileSync(new URL("../payment-confirm.html", import.meta.url), "utf8"), /viewport-fit=cover/);
assert.match(readFileSync(new URL("../profile.html", import.meta.url), "utf8"), /viewport-fit=cover/);
assert.match(readFileSync(new URL("../companion-center.html", import.meta.url), "utf8"), /viewport-fit=cover/);

// Pre-submit status wording
assert.match(team, /待提交/);
assert.doesNotMatch(team, /确认状态<\/dt><dd>待确认/);

// Game ID retained in snapshot text
assert.match(placeMultiSrc, /游戏ID：\$\{line\.gameId\}/);
assert.match(placeMultiSrc, /sharedGameId \|\| line\.gameId \|\| line\.game_id/);
assert.match(placeMultiSrc, /stripOptionalOrderColumns|OPTIONAL_ORDER_COLUMNS/);
assert.match(modal, /游戏ID \*/);
assert.match(modal, /data-po-game-id-edit/);
assert.match(modal, /requireModalGameId/);
assert.doesNotMatch(modal, /联系方式|区服/);

// Time auto end
assert.match(modal, /addHoursToTime/);
assert.match(team, /addHoursToTime/);
assert.match(readFileSync(new URL("../src/mcj-time-picker.js", import.meta.url), "utf8"), /MCJTimePicker/);

// Voice retained in description when column missing
assert.match(placeMultiSrc, /语音方式：\$\{voiceMode === "discord"/);

// Tutorial route + content
assert.equal(existsSync(new URL("../guide.html", import.meta.url)), true);
assert.match(guideCfg, /游戏 ID/);
assert.match(guideCfg, /Discord/);
assert.match(guideCfg, /继续选陪玩/);

// place_multi_order survives Production-like missing optional columns
{
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orders = [];
  let seq = 0;
  const debits = [];
  async function supabaseJson(url, opts = {}) {
    const method = String(opts.method || "GET").toUpperCase();
    if (method === "GET") return [];
    if (method === "POST") {
      const row = JSON.parse(opts.body);
      // Simulate Production: reject optional columns
      for (const k of ["voice_mode", "game_id_value", "service_name", "payment_method", "notes", "quantity"]) {
        if (Object.prototype.hasOwnProperty.call(row, k)) {
          const err = new Error(`Could not find the '${k}' column of 'orders' in the schema cache`);
          throw err;
        }
      }
      row.id = `ord-${++seq}`;
      orders.push(row);
      return [row];
    }
    if (method === "PATCH") {
      const id = decodeURIComponent((String(url).match(/id=eq\.([^&]+)/) || [])[1] || "");
      const patch = JSON.parse(opts.body);
      // paid_at / paid_cat_food missing
      if (patch.paid_at != null || patch.paid_cat_food != null) {
        throw new Error("Could not find the 'paid_cat_food' column of 'orders' in the schema cache");
      }
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
      cp: { user_id: id, display_name: "陪玩", level_id: "lv2" },
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
    resolveOrderUnitPrice: async ({ gameName }) => ({
      price: String(gameName).includes("三角洲") ? 35 : 30,
      source: "admin_set",
      serviceRow: { id: "r1", service_name: gameName },
    }),
  };
  const result = await placeMultiOrder({
    profile: { id: "boss-1" },
    body: {
      idempotencyKey: "remaining-schema-soft",
      gameId: "BOSS_GID_99",
      paymentMethod: "catfood",
      voiceMode: "discord",
      companions: [
        {
          companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          service: "三角洲 手游 国服",
          hours: 1,
          unitPrice: 35,
          totalAmount: 35,
          gameId: "BOSS_GID_99",
        },
        {
          companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          service: "王者荣耀 国服",
          hours: 1,
          unitPrice: 30,
          totalAmount: 30,
          gameId: "BOSS_GID_99",
        },
      ],
    },
    deps,
  });
  assert.equal(result.ok, true, result.message);
  // #281: place_multi_order is create-only; pay_order debits parent once later.
  assert.equal(debits.length, 0, "create must not debit; pay_order owns wallet debit");
  assert.equal(result.walletDebited, false);
  assert.equal(result.next, "payment-confirm");
  assert.equal(String(orders[0].status), "awaiting_payment");
  assert.equal(Number(orders[0].total_amount), 65);
  const children = orders.filter((o) => o.parent_order_id);
  assert.equal(children.length, 2);
  assert.equal(Number(children[0].unit_price), 35);
  assert.equal(Number(children[1].unit_price), 30);
  assert.match(children[0].description, /游戏ID：BOSS_GID_99/);
  assert.match(children[0].description, /语音方式：Discord语音房/);
  assert.equal(Object.prototype.hasOwnProperty.call(children[0], "game_id_value"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(children[0], "voice_mode"), false);
}

// P0-1B: sharedGameId wins over stale per-line IDs when game_id_value column exists
{
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const orders = [];
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
      cp: { user_id: id, display_name: "陪玩", level_id: "lv2" },
    }),
    priceForGame: () => 0,
    assertNotSelfTrade: () => {},
    assertOrderPaymentMethodAllowed: async (code) => ({ ok: true, code: code || "catfood" }),
    isWalletMethod: (m) => String(m).toLowerCase() === "catfood",
    debitWallet: async () => {},
    viewOrder: (o) => o,
    addSystemMessage: async () => {},
    resolveOrderUnitPrice: async ({ gameName }) => ({
      price: 30,
      source: "admin_set",
      serviceRow: { id: "r1", service_name: gameName },
    }),
  };
  const result = await placeMultiOrder({
    profile: { id: "boss-1" },
    body: {
      idempotencyKey: "p01b-shared-id-wins",
      gameId: "XYZ888",
      paymentMethod: "catfood",
      voiceMode: "game_mic",
      companions: [
        {
          companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          service: "三角洲手游 国服",
          hours: 1,
          unitPrice: 30,
          totalAmount: 30,
          gameId: "ABC123",
        },
        {
          companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          service: "三角洲手游 国服",
          hours: 1,
          unitPrice: 30,
          totalAmount: 30,
          gameId: "OLD999",
        },
      ],
    },
    deps,
  });
  assert.equal(result.ok, true, result.message);
  const children = orders.filter((o) => o.parent_order_id);
  assert.equal(children.length, 2);
  assert.equal(children[0].game_id_value, "XYZ888");
  assert.equal(children[1].game_id_value, "XYZ888");
  assert.match(children[0].description, /游戏ID：XYZ888/);
  assert.match(children[1].description, /游戏ID：XYZ888/);
  assert.doesNotMatch(children[0].description, /ABC123|OLD999/);
}

console.log("verify-remaining-multi-order-flow: PASS");
