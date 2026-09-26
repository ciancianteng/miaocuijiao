/**
 * Pure-logic smoke for weekly completed TOP3 ranking (no DB writes).
 * Run: node scripts/verify-weekly-completed-top3.mjs
 */
import { countsTowardCompanionCompleted } from "../server/api/_popularity.js";
import { isRealCompletedOrder } from "../server/api/_business-order-stats.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Status SoT must match business stats
assert(isRealCompletedOrder({ status: "completed" }), "completed counts");
assert(isRealCompletedOrder({ status: "reviewed" }), "reviewed counts");
assert(!isRealCompletedOrder({ status: "in_progress" }), "in_progress excluded");
assert(!isRealCompletedOrder({ status: "cancelled" }), "cancelled excluded");
assert(!isRealCompletedOrder({ status: "awaiting_payment" }), "awaiting_payment excluded");

// Companion credit rules
assert(
  countsTowardCompanionCompleted({
    status: "completed",
    companion_id: "c1",
    id: "o1",
  }),
  "standalone completed credits companion"
);
assert(
  !countsTowardCompanionCompleted({
    status: "completed",
    companion_id: "c1",
    order_type: "multi_group",
    id: "parent1",
  }),
  "multi parent never credits"
);
assert(
  countsTowardCompanionCompleted({
    status: "completed",
    companion_id: "c1",
    parent_order_id: "parent1",
    id: "child1",
  }),
  "multi child credits once"
);
assert(
  !countsTowardCompanionCompleted({
    status: "completed",
    id: "orphan",
  }),
  "no companion_id → no credit"
);

// Sort: completed DESC → rating DESC → lastCompleted DESC
const rows = [
  { id: "a", completedOrders: 5, averageRating: 4.5, lastCompletedAt: "2026-09-20T10:00:00Z" },
  { id: "b", completedOrders: 8, averageRating: 4.0, lastCompletedAt: "2026-09-21T10:00:00Z" },
  { id: "c", completedOrders: 5, averageRating: 4.9, lastCompletedAt: "2026-09-19T10:00:00Z" },
  { id: "d", completedOrders: 5, averageRating: 4.5, lastCompletedAt: "2026-09-22T10:00:00Z" },
  { id: "e", completedOrders: 3, averageRating: 5.0, lastCompletedAt: "2026-09-23T10:00:00Z" },
];
rows.sort((a, b) => {
  if (b.completedOrders !== a.completedOrders) return b.completedOrders - a.completedOrders;
  if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
  return String(b.lastCompletedAt).localeCompare(String(a.lastCompletedAt));
});
const top3 = rows.slice(0, 3).map((r) => r.id);
assert(top3[0] === "b", "TOP1 = most completed");
assert(top3[1] === "c", "TOP2 = higher rating among ties");
assert(top3[2] === "d", "TOP3 = more recent among equal rating");
assert(!top3.includes("a"), "older equal-rating loses to recent");
assert(!top3.includes("e"), "4th by completed stays out");

console.log(
  JSON.stringify(
    {
      ok: true,
      sortTop3: top3,
      rules: [
        "status completed|reviewed only",
        "multi parent excluded; child credits companion once",
        "sort: completed DESC → rating DESC → lastCompleted DESC",
      ],
    },
    null,
    2
  )
);
