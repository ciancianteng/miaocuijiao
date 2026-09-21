#!/usr/bin/env node
/** Offline checks for profile real-review empty-state copy. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const js = read("src/profile-detail.js");
const css = read("src/profile-marketplace.css");
const html = read("profile.html");
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log("PASS ", name);
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message || e) });
    console.error("FAIL ", name, e.message || e);
  }
}

test("empty state uses 暂无评价 title (no emoji newcomer line)", () => {
  assert.match(js, /pd-review-empty-title">暂无评价</);
  assert.doesNotMatch(js, /⭐ 新人陪玩/);
  assert.doesNotMatch(js, /暂无真实订单评价/);
});

test("empty state uses clarified subtitle", () => {
  assert.match(
    js,
    /pd-review-empty-sub">完成订单后将展示老板的真实评价与排名</
  );
});

test("section title and newcomer badge labels preserved", () => {
  assert.match(js, /<h2>真实订单评价<\/h2>/);
  assert.match(js, /新人陪玩/);
});

test("empty markup only when reviewList is empty", () => {
  assert.match(js, /var reviewHtml = reviewList\.length/);
  const emptyIdx = js.indexOf("pd-review-empty-title");
  const listBranch = js.indexOf("var reviewHtml = reviewList.length");
  assert.ok(emptyIdx > listBranch, "empty copy must sit in reviewHtml ternary");
});

test("CSS sizes title larger than subtitle", () => {
  assert.match(css, /\.pd-review-empty-title\{[\s\S]*?font-size:15px/);
  assert.match(css, /\.pd-review-empty-sub\{[\s\S]*?font-size:13px/);
});

test("cache bust updated", () => {
  assert.match(html, /profile-detail\.js\?v=20260921reviewEmptyCopy/);
  assert.match(html, /profile\.css\?v=20260921reviewEmptyCopy/);
});

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error("\n" + failed.length + " failed");
  process.exit(1);
}
console.log("\nAll " + results.length + " checks passed");
