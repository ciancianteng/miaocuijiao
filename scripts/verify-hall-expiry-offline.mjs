import {
  HALL_UNASSIGNED_TTL_MS,
  buildUnassignedHallExpirePatch,
  hallExpireMatch,
  hallOrderBlocksGrab,
  hallStateForOrder,
  unassignedHallPastTtl,
} from "../server/api/_order-flow.js";

const created = "2026-10-01T14:01:32.000Z";
const now = Date.parse("2026-10-29T00:00:00+08:00");
const freshAt = new Date(now - 60 * 60 * 1000).toISOString();
let failed = 0;
function check(name, ok) {
  if (!ok) {
    failed += 1;
    console.error("FAIL", name);
  } else {
    console.log("PASS", name);
  }
}

const stale = { order_no: "MCJ0000435", status: "waiting_boss_confirm", companion_id: null, created_at: created, note: "" };
check("ttl is 24h", HALL_UNASSIGNED_TTL_MS === 24 * 60 * 60 * 1000);
check("MCJ0000435 past 24h", unassignedHallPastTtl(stale, now));
check("MCJ0000435 hall expired", hallStateForOrder(stale, [{ companionId: "a" }], now) === "expired");
check("MCJ0000435 cannot grab", hallOrderBlocksGrab(stale, now) === "expired");
const patch = buildUnassignedHallExpirePatch(stale, "2026-10-29T00:00:00.000Z");
check("expire keeps row and marks cancelled", patch.status === "cancelled" && patch.note.includes("[[ORDER_EXPIRED]]") && !patch.id);
check("expire match cannot hit assigned rows", hallExpireMatch("abc").includes("companion_id=is.null") && hallExpireMatch("abc").includes("status.eq.pending"));

const assigned = { status: "in_progress", companion_id: "pw", created_at: created };
check("assigned over 24h stays", unassignedHallPastTtl(assigned, now) === false && hallOrderBlocksGrab(assigned, now) === "assigned");
const claimed = { status: "claimed", companion_id: "pw", created_at: created };
check("claimed not auto expired", unassignedHallPastTtl(claimed, now) === false && hallStateForOrder(claimed, [], now) === "settled");

const fresh = { status: "pending", companion_id: null, created_at: freshAt };
check("fresh order stays open", unassignedHallPastTtl(fresh, now) === false && hallStateForOrder(fresh, [], now) === "grabbing");
check("fresh can grab", hallOrderBlocksGrab(fresh, now) === "");

const cancelled = { status: "cancelled", companion_id: null, created_at: freshAt };
check("cancelled blocked", hallOrderBlocksGrab(cancelled, now) === "cancelled" && hallStateForOrder(cancelled, [], now) === "cancelled");
const justExpired = { status: "pending", companion_id: null, created_at: new Date(now - HALL_UNASSIGNED_TTL_MS).toISOString() };
check("exactly 24h expires", unassignedHallPastTtl(justExpired, now));
const almost = { status: "pending", companion_id: null, created_at: new Date(now - HALL_UNASSIGNED_TTL_MS + 1000).toISOString() };
check("23:59 stays", unassignedHallPastTtl(almost, now) === false);

const listed = [stale, fresh, cancelled, assigned].filter((o) => {
  const st = hallStateForOrder(o, [], now);
  return st === "open" || st === "grabbing";
});
check("hall list keeps only fresh", listed.length === 1 && listed[0].status === "pending");

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("hall expiry checks ok");
