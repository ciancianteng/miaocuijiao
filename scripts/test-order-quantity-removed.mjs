import assert from "node:assert/strict";
import fs from "node:fs";

const modal = fs.readFileSync(new URL("../src/place-order-modal.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/place-order-page.js", import.meta.url), "utf8");
const team = fs.readFileSync(new URL("../src/multi-companion-team.js", import.meta.url), "utf8");

for (const [name, src] of [["modal", modal], ["page", page], ["team", team]]) {
  assert.equal(src.includes("data-po-quantity"), false, name + " still has a quantity input");
  assert.equal(src.includes("data-mcj-team-qty"), false, name + " still has a team quantity input");
  assert.equal(src.includes(">数量<"), false, name + " still shows a quantity label");
  assert.equal(src.includes("数量或时长"), false, name + " still titles the duration field as quantity");
}

assert.match(modal, /function currentQuantity\(\) \{\s*return 1;\s*\}/);
assert.match(page, /function currentQuantity\(\) \{\s*return 1;\s*\}/);
assert.match(modal, /money\(c\.unitPrice\) \* currentHours\(\) \* currentQuantity\(\)/);
assert.match(modal, /data-po-footer-unit/);
assert.match(modal, /data-po-footer-discount/);
assert.match(modal, /data-po-footer-total/);
assert.match(modal, /label: "1 小时"/);
assert.match(modal, /label: "2 小时"/);
assert.match(modal, /label: "3 小时"/);
assert.match(modal, /data-po-hours/);
assert.match(page, /data-po-footer-unit/);
assert.match(page, /data-po-footer-total/);
assert.match(team, /return Math\.round\(unit \* hours \* 100\) \/ 100;/);
assert.doesNotMatch(team, /unit \* hours \* qty/);

function orderTotal(unitPrice, hours, companions) {
  const people = companions.map(function (unit) {
    return Math.round(unit * hours * 100) / 100;
  });
  return Math.round(people.reduce(function (sum, n) { return sum + n; }, 0) * 100) / 100;
}

assert.equal(orderTotal(20, 1, [20]), 20);
assert.equal(orderTotal(20, 2, [20]), 40);
assert.equal(orderTotal(20, 3, [20]), 60);
assert.equal(orderTotal(40, 2.5, [40]), 100);
assert.equal(orderTotal(40, 2, [40, 30]), 140);
assert.equal(orderTotal(45, 1, [45, 40]), 85);

console.log("order quantity removal checks passed");
