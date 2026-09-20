#!/usr/bin/env node
/**
 * Offline verification: multi-order partial cancel / confirmation UX / replacement.
 * Does NOT touch Production / Staging DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConfirmationQueue,
  companionConfirmUiState,
  isCompanionUnavailableExit,
  simulateAcceptChild,
  simulateKeepRemaining,
  simulateReplaceCompanion,
  simulateSoftExitQueue,
  softExitPatch,
  UNAVAILABLE_MARKER,
} from "../server/api/_multi-order-partial.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

const parentId = "P-multi-1";
function threePending() {
  return [
    {
      id: "cA",
      companion_id: "A",
      companionName: "陪玩A",
      parent_order_id: parentId,
      status: "claimed",
      total_amount: 30,
      created_at: "2026-09-20T01:00:00Z",
    },
    {
      id: "cB",
      companion_id: "B",
      companionName: "陪玩B",
      parent_order_id: parentId,
      status: "claimed",
      total_amount: 40,
      created_at: "2026-09-20T01:00:01Z",
    },
    {
      id: "cC",
      companion_id: "C",
      companionName: "陪玩C",
      parent_order_id: parentId,
      status: "claimed",
      total_amount: 50,
      created_at: "2026-09-20T01:00:02Z",
    },
  ];
}

test("TEST 1 three companions all pending/clock", () => {
  const q = buildConfirmationQueue(threePending());
  assert.equal(q.queue.length, 3);
  assert.ok(q.queue.every((x) => x.statusKey === "pending" && x.icon === "clock"));
  assert.equal(q.needsBossDecision, false);
});

test("TEST 2 B accept => only B becomes check", () => {
  const after = simulateAcceptChild({ children: threePending(), acceptChildId: "cB" });
  const byId = Object.fromEntries(after.queue.queue.map((x) => [x.childId, x]));
  assert.equal(byId.cA.statusKey, "pending");
  assert.equal(byId.cA.icon, "clock");
  assert.equal(byId.cB.statusKey, "accepted");
  assert.equal(byId.cB.icon, "check");
  assert.equal(byId.cC.statusKey, "pending");
  assert.equal(byId.cC.icon, "clock");
});

test("TEST 3 A reject => A becomes replacement slot", () => {
  let kids = threePending();
  kids = simulateAcceptChild({ children: kids, acceptChildId: "cB" }).children;
  const exited = simulateSoftExitQueue({ children: kids, exitChildId: "cA", reason: "时间无法配合" });
  const a = exited.queue.queue.find((x) => x.childId === "cA");
  assert.ok(a);
  assert.equal(a.needsReplacement, true);
  assert.equal(a.statusKey, "exited");
  assert.ok(isCompanionUnavailableExit(exited.children.find((c) => c.id === "cA")));
});

test("TEST 4 after A reject, B check unchanged", () => {
  let kids = threePending();
  kids = simulateAcceptChild({ children: kids, acceptChildId: "cB" }).children;
  const exited = simulateSoftExitQueue({ children: kids, exitChildId: "cA" });
  const b = exited.queue.queue.find((x) => x.childId === "cB");
  assert.equal(b.statusKey, "accepted");
  assert.equal(b.icon, "check");
});

test("TEST 5 after A reject, C pending unchanged", () => {
  let kids = threePending();
  kids = simulateAcceptChild({ children: kids, acceptChildId: "cB" }).children;
  const exited = simulateSoftExitQueue({ children: kids, exitChildId: "cA" });
  const c = exited.queue.queue.find((x) => x.childId === "cC");
  assert.equal(c.statusKey, "pending");
  assert.equal(c.icon, "clock");
});

test("TEST 6 boss prompt copy for unavailable companion", () => {
  const ordersHtml = read("orders.html");
  assert.match(ordersHtml, /当前陪玩无法接单，请重新选择陪玩/);
  assert.match(ordersHtml, /unavailableModal/);
  assert.match(ordersHtml, /data-unavailable-reselect/);
  assert.match(ordersHtml, /data-unavailable-later/);
  assert.match(ordersHtml, /openUnavailableModal/);
  const companionApi = read("server/api/companion.js");
  assert.match(companionApi, /order_companion_unavailable/);
  assert.match(companionApi, /MULTI_CHILD_SOFT_EXIT/);
  assert.match(companionApi, /softExitMultiChildOrder/);
});

test("TEST 7 replacement joins original parent", () => {
  let kids = threePending();
  kids = simulateAcceptChild({ children: kids, acceptChildId: "cB" }).children;
  kids = simulateSoftExitQueue({ children: kids, exitChildId: "cA" }).children;
  const rep = simulateReplaceCompanion({
    children: kids,
    replaceChildId: "cA",
    newCompanionId: "D",
    newChildId: "cD",
  });
  assert.equal(rep.ok, true);
  assert.equal(rep.parentOrderId, parentId);
  assert.equal(rep.replacement.parent_order_id, parentId);
  assert.equal(rep.replacement.status, "claimed");
  const ordersApi = read("server/api/orders.js");
  assert.match(ordersApi, /action === "replace_companion"/);
  assert.match(ordersApi, /parent_order_id: parentId/);
  assert.match(ordersApi, /replacement: true/);
});

test("TEST 8 replacement does not reset other confirmations", () => {
  let kids = threePending();
  kids = simulateAcceptChild({ children: kids, acceptChildId: "cB" }).children;
  kids = simulateSoftExitQueue({ children: kids, exitChildId: "cA" }).children;
  const rep = simulateReplaceCompanion({
    children: kids,
    replaceChildId: "cA",
    newCompanionId: "D",
    newChildId: "cD",
  });
  assert.equal(rep.ok, true);
  const byId = Object.fromEntries(rep.queue.queue.map((x) => [x.childId, x]));
  assert.equal(byId.cB.statusKey, "accepted");
  assert.equal(byId.cC.statusKey, "pending");
  assert.equal(byId.cD.statusKey, "pending");
});

test("TEST 9 cancelled child history retained", () => {
  let kids = threePending();
  kids = simulateSoftExitQueue({ children: kids, exitChildId: "cA" }).children;
  const a = kids.find((c) => c.id === "cA");
  assert.equal(a.status, "cancelled");
  assert.equal(a.companion_id, "A");
  assert.equal(a.parent_order_id, parentId);
  assert.ok(String(a.note || "").includes(UNAVAILABLE_MARKER));
  const q = buildConfirmationQueue(kids);
  assert.ok(q.history.some((h) => h.child.id === "cA" && h.ui.showInHistory));
  const ordersHtml = read("orders.html");
  assert.match(ordersHtml, /退出陪玩记录/);
  assert.match(ordersHtml, /无法接单 \/ 已退出/);
  // keep_remaining also retains row
  const keep = simulateKeepRemaining({ children: kids, exitedChildId: "cA" });
  assert.equal(keep.ok, true);
  assert.ok(keep.children.find((c) => c.id === "cA"));
  const ordersApi = read("server/api/orders.js");
  assert.match(ordersApi, /action === "keep_remaining"/);
  assert.match(ordersApi, /KEEP_REMAINING/);
});

test("TEST 10 mobile UI no overflow (confirm row layout)", () => {
  const ordersHtml = read("orders.html");
  assert.match(ordersHtml, /od-confirm-row/);
  assert.match(ordersHtml, /grid-template-columns:40px minmax\(0,1fr\) 28px/);
  assert.match(ordersHtml, /od-confirm-icon/);
  assert.match(ordersHtml, /od-replace-slot/);
  assert.match(ordersHtml, /\+ 重新选择陪玩/);
  assert.match(ordersHtml, /@media\(max-width:560px\)[\s\S]*od-confirm-row/);
  assert.match(ordersHtml, /minmax\(0,1fr\)/);
  // Status icon fixed on the right column — name uses ellipsis, not push
  assert.match(ordersHtml, /od-confirm-name\{[^}]*text-overflow:ellipsis/);
  assert.match(ordersHtml, /只保留剩余陪玩继续/);
});

test("TEST 11 softExitPatch keeps companion_id semantics (no hall reopen)", () => {
  const patch = softExitPatch({ reason: "临时有事", companionId: "A", companionName: "陪玩A" });
  assert.equal(patch.status, "cancelled");
  assert.ok(patch.note.includes(UNAVAILABLE_MARKER));
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "companion_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "order_type"), false);
  const companionApi = read("server/api/companion.js");
  assert.match(companionApi, /parent_order_id[\s\S]*softExitMultiChildOrder/);
  assert.doesNotMatch(
    companionApi.slice(companionApi.indexOf("if (before.parent_order_id)"), companionApi.indexOf("Legacy standalone")),
    /order_type:\s*"open_grab"/
  );
});

test("TEST 12 loadOrders selects parent_order_id for boss grouping", () => {
  const ordersApi = read("server/api/orders.js");
  assert.match(ordersApi, /parent_order_id,paid_cat_food,paid_at/);
  assert.match(ordersApi, /companionConfirm/);
  const placeModal = read("src/place-order-modal.js");
  assert.match(placeModal, /replace_companion/);
  assert.match(placeModal, /mcjReplaceSlot/);
  const hall = read("companion-center.html");
  assert.match(hall, /mode=replace|mode === "replace"/);
  assert.match(hall, /补位选择（replacement）/);
});

test("TEST 13 accept path refreshes parent without resetting siblings", () => {
  const companionApi = read("server/api/companion.js");
  assert.match(companionApi, /refreshParentWithDeps/);
  const ui = companionConfirmUiState({
    id: "x",
    parent_order_id: parentId,
    status: "in_progress",
    companion_id: "B",
  });
  assert.equal(ui.key, "accepted");
  assert.equal(ui.icon, "check");
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  process.exitCode = 1;
}
