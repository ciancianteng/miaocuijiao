import assert from "node:assert/strict";
import { nestParentOnlyOrders } from "../server/api/_order-group.js";

const parent = {
  id: "p1",
  order_type: "multi_group",
  isMultiGroupParent: true,
  status: "completed",
  companion_id: null,
  canReview: false,
  reviewed: false,
};
const c1 = {
  id: "c1",
  parentOrderId: "p1",
  parent_order_id: "p1",
  status: "completed",
  companionId: "u1",
  companion_id: "u1",
  companionName: "小灰灰",
  canReview: true,
  reviewed: false,
};
const c2 = {
  id: "c2",
  parentOrderId: "p1",
  parent_order_id: "p1",
  status: "completed",
  companionId: "u2",
  companion_id: "u2",
  companionName: "小宏",
  canReview: false,
  reviewed: true,
};
const c3 = {
  id: "c3",
  parentOrderId: "p1",
  parent_order_id: "p1",
  status: "cancelled",
  companionId: "u3",
  companion_id: "u3",
  companionName: "已退出",
  canReview: false,
  reviewed: false,
};

const nested = nestParentOnlyOrders([parent, c1, c2, c3]);
assert.equal(nested.length, 1);
assert.equal(nested[0].children.length, 3);
assert.equal(nested[0].canReview, true);
assert.equal(nested[0].reviewed, false);
assert.equal(nested[0].multiReview.total, 2);
assert.equal(nested[0].multiReview.done, 1);
assert.equal(nested[0].multiReview.pending, 1);

const allDone = nestParentOnlyOrders([
  parent,
  { ...c1, canReview: false, reviewed: true, status: "reviewed" },
  { ...c2, canReview: false, reviewed: true, status: "reviewed" },
]);
assert.equal(allDone[0].canReview, false);
assert.equal(allDone[0].reviewed, true);
assert.equal(allDone[0].multiReview.pending, 0);

console.log("PASS multi review nestParentOnlyOrders");
