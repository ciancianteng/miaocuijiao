/**
 * Offline checks for MCJ game service price table final UX.
 * Does not touch order math / payment / wallet.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PRICE_TABLE_DEFAULT_CATEGORIES,
  groupGamesForPriceTable,
  inferGameFamily,
  resolvePriceCategory,
} from "../server/api/_price-table-catalog.js";

const ROOT = process.cwd();
const fails = [];
function check(cond, msg) {
  if (!cond) fails.push(msg);
}

const pageJs = fs.readFileSync(path.join(ROOT, "src/club-levels-page.js"), "utf8");
const pageCss = fs.readFileSync(path.join(ROOT, "src/club-levels.css"), "utf8");
const pageHtml = fs.readFileSync(path.join(ROOT, "club-levels.html"), "utf8");
const apiJs = fs.readFileSync(path.join(ROOT, "server/api/public/club-price-table.js"), "utf8");
const adminJs = fs.readFileSync(path.join(ROOT, "src/admin-service-manager.js"), "utf8");
const adminApi = fs.readFileSync(path.join(ROOT, "server/api/admin/services.js"), "utf8");
const lvMarkup = fs.readFileSync(path.join(ROOT, "server/api/_lv-markup.js"), "utf8");
const orders = fs.readFileSync(path.join(ROOT, "server/api/orders.js"), "utf8");

check(/data-price-mode="games"/.test(pageJs), "missing games mode tab");
check(/data-price-mode="levels"/.test(pageJs), "missing levels mode tab");
check(/mode:\s*"games"/.test(pageJs), "default mode must be games");
check(/mcj-mode-tabs/.test(pageCss), "missing mode tabs CSS");
check(/mcj-svc-item/.test(pageCss), "missing base-price service row CSS");
check(/20261120priceFinal1/.test(pageHtml), "club-levels cache bust missing");
check(/categories/.test(apiJs) && /groups/.test(apiJs), "public API must return categories + groups");
check(/markupAllowance/.test(apiJs), "public API must expose level markupAllowance");
check(/delete_category/.test(adminApi) && /reassignTo/.test(adminApi), "admin safe delete missing");
check(/reorder_categories/.test(adminApi), "admin reorder categories missing");
check(/data-service-categories/.test(adminJs), "admin category panel missing");
check(/deleteCategorySafe/.test(adminJs), "admin safe delete UI missing");
check(!/mcj-svc-lv/.test(pageJs), "Lv1-5 final price rows must be removed from games expand");
check(!/最终单价/.test(pageJs), "games pane must not show 最终单价");
check(/mcj-svc-item/.test(pageJs) && /basePrice/.test(pageJs), "expand must show base price items");
check(/quoteMarkupPrice|computeFinalPrice/.test(lvMarkup), "lv-markup SoT still present");
check(/export default|function handler/.test(orders), "orders handler untouched presence");

assert.equal(resolvePriceCategory("娱乐", "原神", ["端游", "手游", "娱乐陪伴"]), "娱乐陪伴");
assert.equal(resolvePriceCategory("端游", "无畏契约 端游 国服", ["端游", "手游", "娱乐陪伴"]), "端游");
assert.equal(resolvePriceCategory("手游", "三角洲 手游 国服 机密", ["端游", "手游", "娱乐陪伴"]), "手游");
assert.equal(inferGameFamily("三角洲 端游 国服 机密"), "三角洲行动");
assert.equal(inferGameFamily("无畏契约 端游 国际服"), "无畏契约");
assert.equal(inferGameFamily("CSGO"), "CSGO");

const groups = groupGamesForPriceTable(
  [
    { id: "1", name: "三角洲 端游 国服 机密", category: "端游", basePrice: 45, unit: "小时", sort: 1, baseConfigured: true },
    { id: "2", name: "三角洲 端游 国服 绝密", category: "端游", basePrice: 55, unit: "小时", sort: 2, baseConfigured: true },
    { id: "3", name: "王者荣耀", category: "手游", basePrice: 25, unit: "小时", sort: 3, baseConfigured: true },
  ],
  PRICE_TABLE_DEFAULT_CATEGORIES
);
assert.equal(groups.length, 2);
const delta = groups.find((g) => g.title === "三角洲行动");
assert.ok(delta);
assert.equal(delta.services.length, 2);
assert.equal(delta.category, "端游");

if (fails.length) {
  console.error("FAIL\n" + fails.map((f) => "- " + f).join("\n"));
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      checks: "price-table-final-offline",
      families: { deltaServices: delta.services.length, groups: groups.length },
    },
    null,
    2
  )
);
