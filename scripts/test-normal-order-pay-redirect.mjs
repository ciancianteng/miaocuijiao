/**
 * Static guard for the normal-order payment handoff.
 * Does not create orders or touch a database.
 */
import fs from "node:fs";
import vm from "node:vm";

const modal = fs.readFileSync(new URL("../src/place-order-modal.js", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/place-order-page.js", import.meta.url), "utf8");
const appointments = fs.readFileSync(new URL("../server/api/appointments.js", import.meta.url), "utf8");
const ordersPage = fs.readFileSync(new URL("../orders.html", import.meta.url), "utf8");
const payPage = fs.readFileSync(new URL("../src/payment-confirm.js", import.meta.url), "utf8");

const failures = [];
function assert(cond, message) {
  if (!cond) failures.push(message);
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

const modalSuccess = between(modal, "fetch(\"/api/orders\"", "function open(");
const pageSuccess = between(page, "fetch(\"/api/orders\"", "function boot(");

assert(modal.includes("function reusePlaceAttemptKey"), "modal keeps a stable attempt key");
assert(modal.includes("function goPaymentPage"), "modal still opens the shared payment page");
assert(modalSuccess.includes("goPaymentPage(order)"), "modal success opens payment for the created order");
assert(!modalSuccess.includes("pay_order"), "modal success does not pay or debit");
assert(!modalSuccess.includes("goOrderSuccess"), "modal success does not jump to the order list");
assert(!modal.includes("orders.html?id="), "modal no longer sends the boss to orders.html?id=");
assert(!/order_type\s*:\s*[\"']appointment[\"']/.test(modal), "modal does not create appointment orders");

assert(page.includes("action: \"place_order\""), "place-order page uses place_order");
assert(!page.includes("create_order"), "place-order page no longer sends the unknown create_order action");
assert(!page.includes("pay_order"), "place-order page does not pay at create time");
assert(!page.includes("orders.html"), "place-order page does not redirect to the order list");
assert(pageSuccess.includes('location.href = "payment-confirm.html?order="'), "place-order page opens payment-confirm for the new id");
assert(page.includes("function reusePageAttemptKey"), "place-order page reuses the attempt key");

assert(
  appointments.includes("预约申请已提交。陪玩确认前不会扣除猫粮，也不会生成支付订单。"),
  "appointment submit still creates no payable order"
);
const acceptAt = appointments.indexOf('if (action === "accept" || action === "reject")');
const createCall = appointments.indexOf("const order = await createAppointmentOrder(row);");
assert(acceptAt > 0 && createCall > acceptAt, "appointment order is created only after companion accept");
assert((appointments.match(/createAppointmentOrder\(/g) || []).length === 2, "appointment order helper has one definition and one accept call");

assert(ordersPage.includes('href="payment-confirm.html?order='), "order list pay button still opens the same payment page");
assert(payPage.includes('action: "submit_payment_proof"'), "payment page still submits proof to the existing review action");
assert(payPage.includes("mcjOrderCache:"), "payment page still reads the order cache written at create time");

function loadReuse(source, name, nextName) {
  const start = source.indexOf("function " + name);
  const end = source.indexOf("function " + nextName, start + 10);
  const body = source.slice(start, end);
  const context = vm.createContext({ sessionStorage: new MapStore() });
  vm.runInContext(body + "\nglobalThis.fn = " + name + ";", context);
  return context.fn;
}

function MapStore() {
  this.map = new Map();
}
MapStore.prototype.getItem = function (key) {
  return this.map.has(key) ? this.map.get(key) : null;
};
MapStore.prototype.setItem = function (key, value) {
  this.map.set(key, String(value));
};
MapStore.prototype.removeItem = function (key) {
  this.map.delete(key);
};

const reuse = loadReuse(modal, "reusePlaceAttemptKey", "clearPlaceAttemptKey");
const first = reuse(["companion-a", "三角洲", 1, 1, "duitnow", "boss-1", 35]);
const second = reuse(["companion-a", "三角洲", 1, 1, "duitnow", "boss-1", 35]);
const changed = reuse(["companion-a", "三角洲", 2, 1, "duitnow", "boss-1", 70]);
assert(first.key && first.key === second.key, "same form reuses one idempotency key");
assert(first.storageKey === second.storageKey, "same form keeps one storage slot");
assert(changed.key !== first.key, "a changed amount gets a new idempotency key");

if (failures.length) {
  console.error(failures.map((item) => "FAIL " + item).join("\n"));
  process.exit(1);
}
console.log("normal-order pay redirect: PASS");
console.log("same-form key reused; changed amount key differs; appointment create stays on accept");
