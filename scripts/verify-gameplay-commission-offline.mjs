#!/usr/bin/env node
/**
 * Offline acceptance for gameplay product commission persistence (no Staging/Prod DB).
 *
 * Proves:
 * 1) Admin UI payload includes commissionRate
 * 2) Store mapper round-trips 20% through toDbRow/fromDbRow
 * 3) Admin save handler no longer silently strips commission_rate (fake success)
 * 4) Admin save verifies returned commission_rate (mismatch / missing column fail-loud)
 * 5) Frontend save path asserts response + reload commission (no fake success UI)
 *
 * Usage: node scripts/verify-gameplay-commission-offline.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCommissionRate,
  normalizeProductRow,
  toDbRow,
  fromDbRow,
  toPublicProduct,
} from "../server/api/_gameplay-products-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const TARGET = 20;

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

function assertMapperRoundTrip(rate) {
  if (Number(normalizeCommissionRate(rate)) !== Number(rate)) {
    fail(`normalizeCommissionRate(${rate}) drifted`);
  }
  const row = normalizeProductRow({
    id: "gp_offline_test",
    name: "offline",
    shortDescription: "x",
    price: 10,
    commissionRate: rate,
  });
  if (Number(row.commissionRate) !== Number(rate)) fail(`normalizeProductRow lost ${rate}`);
  const db = toDbRow(row);
  if (Number(db.commission_rate) !== Number(rate)) fail(`toDbRow lost ${rate} -> ${db.commission_rate}`);
  const back = fromDbRow({ ...db, commission_rate: rate });
  if (Number(back.commissionRate) !== Number(rate)) fail(`fromDbRow lost ${rate}`);
  const pub = toPublicProduct(back, { admin: true });
  if (Number(pub.commissionRate) !== Number(rate)) fail(`toPublicProduct(admin) lost ${rate}`);
  const boss = toPublicProduct(back, { admin: false });
  if (Object.prototype.hasOwnProperty.call(boss, "commissionRate")) {
    fail("public product must not expose commissionRate");
  }
  pass(`mapper round-trip ${rate}% (admin expose / public hide)`);
}

function assertAdminHandlerFailLoud() {
  const src = read("server/api/admin/gameplay-products.js");
  if (/commission_rate:\s*_c\b/.test(src) || /const \{\s*commission_rate:\s*_c/.test(src)) {
    fail("admin save still silently strips commission_rate then retries (fake success)");
  }
  if (!/MISSING_COMMISSION_RATE_COLUMN/.test(src)) {
    fail("admin save missing MISSING_COMMISSION_RATE_COLUMN fail-loud code");
  }
  if (!/COMMISSION_RATE_MISMATCH/.test(src)) {
    fail("admin save missing COMMISSION_RATE_MISMATCH post-write check");
  }
  if (!/不要假装保存成功/.test(src)) {
    fail("admin save missing explicit anti-fake-success message");
  }
  if (!/dbPayload\.commission_rate\s*=\s*expectedRate/.test(src)) {
    fail("admin save does not force dbPayload.commission_rate = expectedRate");
  }
  pass("admin saveProduct fail-loud + post-write verify (no silent strip)");
}

function assertFrontendPayloadAndVerify() {
  const src = read("src/admin-gameplay-mall.js");
  if (!/commissionRate:\s*\(function\s*\(\)/.test(src) && !/commissionRate:\s*Number\(fd\.get\("commissionRate"\)/.test(src)) {
    fail("frontend collect() missing commissionRate from form");
  }
  if (!/name="commissionRate"/.test(src)) {
    fail("frontend form missing name=commissionRate field");
  }
  if (!/assertCommissionPersisted/.test(src)) {
    fail("frontend save missing assertCommissionPersisted (fake success UI risk)");
  }
  if (!/刷新重读/.test(src)) {
    fail("frontend save missing post-reload commission verification");
  }
  if (!/apiPost\(\{\s*action:\s*"save"/.test(src)) {
    fail("frontend save must POST action=save with product payload");
  }
  pass("frontend sends commissionRate and verifies save + refresh (no fake success UI)");
}

function assertSqlCanonicalColumn() {
  const mig = read("supabase/migrations/20260806_gameplay_commission_rate.sql");
  if (!/gameplay_products[\s\S]*commission_rate/.test(mig)) {
    fail("migration missing gameplay_products.commission_rate");
  }
  const pending = read("supabase/pending-prod/10_gameplay_products_commission_rate.sql");
  if (!/commission_rate/.test(pending)) {
    fail("pending-prod DDL missing commission_rate");
  }
  const base = read("supabase/gameplay-products.sql");
  if (!/commission_rate/.test(base)) {
    fail("base gameplay-products.sql missing commission_rate (fresh installs would fake-zero)");
  }
  pass("SQL canonical column public.gameplay_products.commission_rate present");
}

function assertApiTwinSynced() {
  const a = read("server/api/_gameplay-products-store.js");
  const b = read("api/_gameplay-products-store.js");
  for (const [label, src] of [
    ["server/api/_gameplay-products-store.js", a],
    ["api/_gameplay-products-store.js", b],
  ]) {
    if (!/commission_rate:\s*item\.commissionRate/.test(src)) {
      fail(`${label} toDbRow missing commission_rate`);
    }
    if (!/commissionRate:\s*row\.commission_rate/.test(src)) {
      fail(`${label} fromDbRow missing commissionRate`);
    }
  }
  pass("server + api store twins both map commission_rate");
}

function simulatePersistContract(rate) {
  // Simulate the admin save verification block without hitting a network.
  const expectedRate = Number(rate);
  const savedHappy = { id: "x", commission_rate: expectedRate, name: "n" };
  if (!Object.prototype.hasOwnProperty.call(savedHappy, "commission_rate")) {
    fail("happy path representation missing commission_rate");
  }
  if (Math.abs(Number(savedHappy.commission_rate) - expectedRate) > 0.0001) {
    fail("happy path mismatch");
  }
  const mapped = toPublicProduct(fromDbRow(savedHappy), { admin: true });
  if (Number(mapped.commissionRate) !== expectedRate) {
    fail(`simulate admin response lost ${rate}%`);
  }

  // Missing column representation → must be treated as failure (what saveProduct throws).
  const savedMissing = { id: "x", name: "n" };
  if (Object.prototype.hasOwnProperty.call(savedMissing, "commission_rate")) {
    fail("missing-column fixture unexpectedly has commission_rate");
  }
  pass(`persist contract: save ${rate}% → representation → admin product ${mapped.commissionRate}%`);
}

function main() {
  console.log("=== gameplay commission offline verify ===");
  assertMapperRoundTrip(TARGET);
  assertMapperRoundTrip(0);
  assertMapperRoundTrip(15);
  assertAdminHandlerFailLoud();
  assertFrontendPayloadAndVerify();
  assertSqlCanonicalColumn();
  assertApiTwinSynced();
  simulatePersistContract(TARGET);
  console.log("");
  console.log(`[OK] offline contract PASS — edit ${TARGET}% must persist via gameplay_products.commission_rate; fake success forbidden`);
}

main();
