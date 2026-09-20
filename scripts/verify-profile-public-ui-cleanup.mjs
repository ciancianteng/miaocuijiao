#!/usr/bin/env node
/** Offline checks for public companion profile UI cleanup. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const js = read("src/profile-detail.js");
const css = read("src/profile.css");
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

test("removes 基本资料 section title from render", () => {
  assert.doesNotMatch(js, /<h2>基本资料<\/h2>/);
});

test("removes online status meta row", () => {
  assert.doesNotMatch(js, /metaRow\("在线状态"/);
});

test("removes order summary / 暂无订单记录 from profile meta", () => {
  assert.doesNotMatch(js, /metaRow\("订单摘要"/);
  assert.doesNotMatch(js, /暂无订单记录/);
});

test("does not render 声线：未设置", () => {
  assert.doesNotMatch(js, /声线：<\/span>' \+\s*\n?\s*esc\(voice \|\| "未设置"\)/);
  assert.match(js, /includeVoice:\s*false/);
});

test("hero uses service chips for game/level/price", () => {
  assert.match(js, /pd-service-chips/);
  assert.match(js, /pd-service-chip/);
  assert.match(css, /\.pd-service-chip\b/);
});

test("hero no longer concatenates game · level line", () => {
  assert.doesNotMatch(js, /game-line[\s\S]{0,80}未设置游戏/);
});

test("keeps bottom CTAs 咨询客服 + 立即下单", () => {
  assert.match(js, /咨询客服/);
  assert.match(js, /立即下单/);
});

test("cache bust updated on profile.html", () => {
  assert.match(html, /profile-detail\.js\?v=20260920profileAlbum1/);
  assert.match(html, /profile\.css\?v=20260920profileAlbum1/);
});

test("always renders 陪玩相册 section (not only when gallery has items)", () => {
  assert.match(js, /陪玩相册/);
  assert.match(js, /data-pd-album-section/);
  assert.match(js, /暂无相册内容/);
  // Must not gate the whole section on galleryList.length alone (empty → disappear)
  assert.match(js, /albumSectionHtml/);
});

test("album section placed before 数据表现", () => {
  const albumIdx = js.indexOf("albumSectionHtml");
  const perfIdx = js.indexOf("<h2>数据表现</h2>");
  assert.ok(albumIdx > 0 && perfIdx > albumIdx, "albumSectionHtml must appear before 数据表现 markup");
});

test("does not restore removed duplicate meta", () => {
  assert.doesNotMatch(js, /<h2>基本资料<\/h2>/);
  assert.doesNotMatch(js, /metaRow\("在线状态"/);
  assert.doesNotMatch(js, /metaRow\("订单摘要"/);
  assert.doesNotMatch(js, /暂无订单记录/);
});

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " passed");
if (failed.length) process.exit(1);
