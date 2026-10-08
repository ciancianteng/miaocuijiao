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
  assert.match(html, /profile-detail\.js\?v=20261008voice3/);
  assert.match(html, /profile\.css\?v=20261008voice3/);
  assert.match(html, /multi-companion-team\.js/);
});

test("always renders photo album section", () => {
  assert.match(js, /照片相册/);
  assert.match(js, /data-pd-album-section/);
  assert.match(js, /暂无照片/);
  assert.match(js, /albumSectionHtml/);
});

test("album section placed before 数据表现", () => {
  const albumIdx = js.indexOf("albumSectionHtml");
  const perfIdx = js.indexOf("<h2>数据表现</h2>");
  assert.ok(albumIdx > 0 && perfIdx > albumIdx, "albumSectionHtml must appear before 数据表现 markup");
});

test("detail page has one order bar and the new section order", () => {
  assert.doesNotMatch(js, /pd-hero-actions/);
  assert.doesNotMatch(js, /pd-newcomer-badge/);
  assert.doesNotMatch(js, /真实订单评价/);
  assert.doesNotMatch(js, /<h2>荣誉<\/h2>/);
  assert.match(js, /<h2>评价<\/h2>/);
  assert.match(js, /<h2>数据表现<\/h2>/);
  const nameAt = js.indexOf('class="pd-name-row"');
  const aboutAt = js.indexOf("<h2>关于TA</h2>");
  assert.match(js, /class="pd-name-row"><h1>' \+[\s\S]{0,240}voiceBody \+/);
  assert.doesNotMatch(js, /data-pd-voice-section/);
  const albumAt = js.indexOf("albumSectionHtml +");
  const serviceAt = js.indexOf("<h2>TA可以提供的服务</h2>");
  const recordAt = js.indexOf("achievementSectionHtml +");
  const statAt = js.indexOf("<h2>数据表现</h2>");
  const giftAt = js.indexOf("<h2>礼物墙</h2>");
  const reviewAt = js.indexOf("<h2>评价</h2>");
  assert.ok(nameAt > 0 && nameAt < aboutAt, "name row sits above 关于TA");
  assert.ok(aboutAt < albumAt && albumAt < serviceAt && serviceAt < recordAt, "about, album, services, records stay in order");
  assert.ok(recordAt < statAt && statAt < giftAt && giftAt < reviewAt, "records, stats, gifts, reviews stay in order");
  const cta = js.split("咨询客服").length - 1;
  assert.equal(cta, 1);
});

test("voice player is only the round toggle", () => {
  assert.match(js, /data-voice-toggle/);
  assert.match(js, /data-voice-glyph/);
  assert.doesNotMatch(js, /pd-voice-range/);
  assert.doesNotMatch(js, /pd-voice-time/);
  assert.doesNotMatch(js, /data-voice-range/);
  assert.match(css, /\.pd-voice-toggle\{[\s\S]*?width:42px !important/);
  assert.match(css, /\.pd-name-row\{[\s\S]*?flex-wrap:nowrap/);
  assert.doesNotMatch(css, /\.pd-voice-range/);
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
