/**
 * Bottom tab label only: 客服 → 消息. Icon and href must stay.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync("index.html", "utf8");
const hall = readFileSync("companion-center.html", "utf8");

const homeTab = home.match(
  /<nav class="mobile-bottom-nav mcj-app-tabbar"[\s\S]*?<\/nav>/
)?.[0];
const hallTab = hall.match(
  /<nav class="bottom-nav mcj-app-tabbar"[\s\S]*?<\/nav>/
)?.[0];
assert.ok(homeTab, "home tabbar missing");
assert.ok(hallTab, "hall tabbar missing");

const homeLabels = [...homeTab.matchAll(/mcj-app-tab-label">([^<]+)</g)].map((m) => m[1]);
assert.deepEqual(homeLabels, ["首页", "大厅", "订单", "消息", "我的"]);
assert.match(homeTab, /data-app-tab="support"><span class="mcj-app-tab-ico"[^>]*>💬<\/span>/);
assert.match(homeTab, /href="support\.html\?start=1"/);
assert.doesNotMatch(homeTab, /mcj-app-tab-label">客服</);

const hallLabels = [...hallTab.matchAll(/data-app-tab="[^"]+">([^<]+)</g)].map((m) => m[1]);
assert.deepEqual(hallLabels, ["首页", "大厅", "订单", "消息", "我的"]);
assert.match(hallTab, /href="support\.html\?start=1"/);
assert.doesNotMatch(hallTab, />客服</);

assert.match(home, /home-brand-hero-btn" href="support\.html\?start=1">联系客服</);
assert.match(home, /<a href="support\.html\?start=1">客服<\/a>/);

console.log("verify-bottom-nav-messages: PASS");
console.log(JSON.stringify({ homeLabels, hallLabels }, null, 2));
