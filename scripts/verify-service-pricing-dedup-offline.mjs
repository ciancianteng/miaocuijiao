#!/usr/bin/env node
/**
 * Offline verification: Admin service-pricing UI dedupe + responsive layout markers.
 * Does NOT mutate Production / DB schema / order price resolvers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEffectiveServicePrice } from "../server/api/_resolve-effective-service-price.js";
import {
  buildAdminServicePriceList,
  parseServicePricesPayload,
  normalizeServiceName,
} from "../server/api/_admin-service-prices.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

const level = { id: "lv2", code: "Lv2", name: "灵喵", base_price: 30, basePrice: 30 };
const SID = {
  wz: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  sj: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2",
  pd: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee3",
};

const companion = {
  user_id: "u-demo",
  level_id: "lv2",
  game: "王者荣耀,三角洲 手游 国服,三角洲跑跑刀 一千万",
  price: 30,
  service_ids: [SID.wz, SID.sj, SID.pd],
  game_prices: {
    王者荣耀: 35,
    "三角洲 手游 国服": 30,
    "三角洲跑跑刀 一千万": 40,
    [SID.wz]: 35,
    [SID.sj]: 30,
    [SID.pd]: 40,
  },
};

const serviceRows = [
  {
    id: "r1",
    companion_id: "u-demo",
    service_id: SID.wz,
    service_name: "王者荣耀",
    price: 35,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
  {
    id: "r2",
    companion_id: "u-demo",
    service_id: SID.sj,
    service_name: "三角洲 手游 国服",
    price: 30,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
  {
    id: "r3",
    companion_id: "u-demo",
    service_id: SID.pd,
    service_name: "三角洲跑跑刀 一千万",
    price: 40,
    enabled: true,
    review_status: "approved",
    source: "admin_set",
  },
];

function byName(list, name) {
  const key = normalizeServiceName(name);
  return list.find((x) => normalizeServiceName(x.serviceName) === key);
}

test("1. three services => Admin list has exactly 3 rows", () => {
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  assert.equal(list.length, 3);
});

test("2. companion_services + game_prices dual keys => no duplicate rows", () => {
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  const names = list.map((x) => normalizeServiceName(x.serviceName));
  assert.equal(new Set(names).size, names.length);
  assert.equal(list.length, 3);
});

test("3. multi-source same service => one effective price (companion_services wins)", () => {
  const mixed = {
    ...companion,
    game_prices: { ...companion.game_prices, 王者荣耀: 99 },
  };
  const staleRows = [
    ...serviceRows.slice(1),
    { ...serviceRows[0], price: 35 },
  ];
  const list = buildAdminServicePriceList(mixed, staleRows, level);
  assert.equal(list.length, 3);
  assert.equal(Number(byName(list, "王者荣耀").unitPrice), 35);
});

test("4. save payload parse dedupes id+name variants (refresh-safe)", () => {
  const parsed = parseServicePricesPayload({
    servicePrices: [
      { serviceId: SID.wz, serviceName: "王者荣耀", unitPrice: 35 },
      { serviceId: "", serviceName: "王者荣耀", unitPrice: 30 },
      { serviceId: SID.sj, serviceName: "三角洲 手游 国服", unitPrice: 30 },
      { serviceId: SID.pd, serviceName: "三角洲跑跑刀 一千万", unitPrice: 40 },
      { serviceId: "", serviceName: "三角洲 手游 国服", unitPrice: 22 },
    ],
  });
  assert.equal(parsed.length, 3);
  assert.equal(Number(byName(parsed, "王者荣耀").unitPrice), 30); // last wins in parse
  // Rebuild admin list after "save" using companion_services canonical prices
  const after = buildAdminServicePriceList(
    {
      ...companion,
      game_prices: {
        王者荣耀: 35,
        "三角洲 手游 国服": 30,
        "三角洲跑跑刀 一千万": 40,
        [SID.wz]: 35,
        [SID.sj]: 30,
        [SID.pd]: 40,
      },
    },
    serviceRows,
    level
  );
  assert.equal(after.length, 3);
  assert.equal(Number(byName(after, "王者荣耀").unitPrice), 35);
});

test("5. Boss resolveServices source markers keep unique names", () => {
  const modal = read("src/place-order-modal.js");
  assert.match(modal, /function resolveServices/);
  assert.match(modal, /seen\["n:" \+ nkey\]/);
  assert.match(modal, /id:/);
  const page = read("src/place-order-page.js");
  assert.match(page, /seen\["n:" \+ nkey\]/);
});

test("6. 王者荣耀 price stays 35", () => {
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  assert.equal(Number(byName(list, "王者荣耀").unitPrice), 35);
  assert.equal(
    resolveEffectiveServicePrice({
      companion,
      gameName: "王者荣耀",
      serviceId: SID.wz,
      serviceRows,
      level,
    }).price,
    35
  );
});

test("7. 三角洲手游 price stays 30", () => {
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  assert.equal(Number(byName(list, "三角洲 手游 国服").unitPrice), 30);
  assert.equal(
    resolveEffectiveServicePrice({
      companion,
      gameName: "三角洲 手游 国服",
      serviceId: SID.sj,
      serviceRows,
      level,
    }).price,
    30
  );
});

test("8. 三角洲跑跑刀 price stays 40", () => {
  const list = buildAdminServicePriceList(companion, serviceRows, level);
  assert.equal(Number(byName(list, "三角洲跑跑刀 一千万").unitPrice), 40);
  assert.equal(
    resolveEffectiveServicePrice({
      companion,
      gameName: "三角洲跑跑刀 一千万",
      serviceId: SID.pd,
      serviceRows,
      level,
    }).price,
    40
  );
});

test("9. single-order path unchanged (orders.js still resolves unit price)", () => {
  const orders = read("server/api/orders.js");
  assert.match(orders, /resolveOrderUnitPrice/);
  assert.match(orders, /action === "place_order"/);
});

test("10. multi-order path unchanged", () => {
  const multi = read("server/api/_place-multi-order.js");
  assert.match(multi, /resolveOrderUnitPrice/);
  assert.match(multi, /place_multi_order|ORDER_TYPE_MULTI_GROUP/);
});

test("11. historical orders not rewritten by admin price helper", () => {
  const adminPrices = read("server/api/_admin-service-prices.js");
  assert.doesNotMatch(adminPrices, /update.*orders|from public\.orders/i);
  const players = read("server/api/admin/players.js");
  assert.doesNotMatch(players, /UPDATE\s+orders|patchOrder.*unit_price/i);
});

test("12. base_price fallback still works", () => {
  const r = resolveEffectiveServicePrice({
    companion: { user_id: "u2", price: 0, game_prices: {} },
    gameName: "新服务",
    serviceRows: [],
    level,
  });
  assert.equal(r.price, 30);
  assert.equal(r.source, "level_base_price");
});

test("13. Admin UI uses CSS grid classes (no inline 140px price column)", () => {
  const detail = read("src/admin-player-detail.js");
  assert.match(detail, /admin-service-price-row/);
  assert.match(detail, /dedupeServicePriceRows/);
  assert.doesNotMatch(detail, /grid-template-columns:1fr 140px/);
  const css = read("src/admin-suite.css");
  assert.match(css, /minmax\(220px,\s*1fr\)\s+minmax\(220px,\s*320px\)/);
  assert.match(css, /min\(1120px,\s*calc\(100vw - 64px\)\)/);
  assert.match(css, /\.player-drawer-actions\{[^}]*justify-content:flex-end/s);
  assert.doesNotMatch(css, /\.admin-service-prices\{[^}]*overflow-x:\s*hidden/s);
});

test("14. name-only leftover game_prices merge into UUID companion_services row", () => {
  const list = buildAdminServicePriceList(
    {
      user_id: "u-demo",
      game: "王者荣耀",
      price: 30,
      game_prices: { 王者荣耀: 28 },
    },
    [
      {
        id: "r1",
        service_id: SID.wz,
        service_name: "王者荣耀",
        price: 35,
        enabled: true,
        review_status: "approved",
      },
    ],
    level
  );
  assert.equal(list.length, 1);
  assert.equal(Number(list[0].unitPrice), 35);
  assert.equal(list[0].serviceId, SID.wz);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`verify:service-pricing-dedup offline: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
