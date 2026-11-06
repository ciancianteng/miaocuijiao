#!/usr/bin/env node
/**
 * MCJ-PLACE-ORDER-UI-APPROVED-V1 offline contract guard.
 * Fails CI if locked place-order UI CSS/JS regresses to old layout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const TAG = "MCJ-PLACE-ORDER-UI-APPROVED-V1";
const CACHE = "20261106poUi8";

let failed = 0;
function ok(msg) {
  console.log(`  OK  ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.error(`  FAIL  ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function mustInclude(hay, needle, label) {
  if (hay.includes(needle)) ok(label);
  else fail(`${label} — missing: ${needle.slice(0, 80)}`);
}

function mustMatch(hay, re, label) {
  if (re.test(hay)) ok(label);
  else fail(`${label} — pattern not found: ${re}`);
}

function mustNotMatch(hay, re, label) {
  if (!re.test(hay)) ok(label);
  else fail(`${label} — forbidden pattern matched: ${re}`);
}

console.log(`[${TAG}] offline freeze check`);

const css = read("src/place-order-modal.css");
const js = read("src/place-order-modal.js");
const ds = read("src/design-system.css");

mustMatch(
  css,
  /\.mcj-po-game-list[\s\S]*?grid-template-columns:\s*repeat\(\s*2\s*,\s*minmax\(0\s*,\s*1fr\)\s*\)/,
  "game-list 2-column grid"
);
mustMatch(
  css,
  /\.mcj-po-game-option\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*row;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*space-between;/,
  "game-option row flex space-between"
);
mustMatch(
  css,
  /\.mcj-po-game-option-name\{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?text-align:\s*left;/,
  "name left flex"
);
mustMatch(
  css,
  /\.mcj-po-game-option-price\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?color:\s*#ff9fcd;/,
  "price right pink #ff9fcd"
);
mustMatch(
  css,
  /@media \(max-width:767px\)\{[\s\S]*?\.mcj-po-game-list[\s\S]*?grid-template-columns:\s*repeat\(\s*2\s*,\s*minmax\(0\s*,\s*1fr\)\s*\)/,
  "mobile ≤767 still 2-column"
);
mustNotMatch(
  css,
  /@media \(max-width:767px\)\{[\s\S]*?\.mcj-po-game-list[\s\S]*?grid-template-columns:\s*1fr\s*[;}]/,
  "mobile must not collapse to 1 column"
);
mustMatch(
  css,
  /\.mcj-po-field:has\(>\s*\.mcj-po-stepper\)\{[\s\S]*?justify-content:\s*space-between;/,
  "duration row space-between"
);
mustMatch(
  css,
  /\.mcj-po-stepper\{[\s\S]*?margin-left:\s*auto;/,
  "duration stepper right-aligned"
);

mustInclude(js, `place-order-modal.css?v=${CACHE}`, `JS CSS cache ${CACHE}`);
mustMatch(js, /document\.head\.appendChild\(link\)/, "ensureCss appends last (wins cascade)");
mustMatch(ds, /\.mcj-po-game-option/, "design-system excludes .mcj-po-game-option");
mustMatch(ds, /\.mcj-po-step/, "design-system excludes .mcj-po-step");
mustMatch(ds, /\.mcj-po-coupon-entry/, "design-system excludes .mcj-po-coupon-entry");

const htmlFiles = [
  "companion-center.html",
  "index.html",
  "place-order.html",
  "profile.html",
  "ranking.html",
];
for (const f of htmlFiles) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, "utf8");
  if (html.includes("place-order-modal")) {
    mustInclude(html, CACHE, `${f} cache ${CACHE}`);
  }
}

const baselineDir = path.join(root, "docs/ui-baselines", TAG);
for (const name of ["desktop.png", "mobile-390.png", "MANIFEST.md"]) {
  const p = path.join(baselineDir, name);
  if (fs.existsSync(p) && fs.statSync(p).size > 100) ok(`baseline ${name}`);
  else fail(`baseline missing/empty: ${name}`);
}

const rule = path.join(root, ".cursor/rules/place-order-ui-approved-v1.mdc");
if (fs.existsSync(rule)) ok("cursor freeze rule present");
else fail("missing .cursor/rules/place-order-ui-approved-v1.mdc");

if (failed) {
  console.error(`[${TAG}] FAILED (${failed})`);
  process.exit(1);
}
console.log(`[${TAG}] PASS`);
