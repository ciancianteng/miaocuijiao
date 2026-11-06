/**
 * Offline unit checks for CS ended-session 72h list visibility.
 */
import {
  ENDED_LIST_VISIBLE_MS,
  filterCsListConversations,
  hintEndedAtFromMessages,
  isEndedConversationListVisible,
  resolveConversationEndedAt,
} from "../server/api/_cs-ended-visibility.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = Date.parse("2026-11-06T12:00:00.000Z");
const h = (hours) => new Date(now - hours * 3600 * 1000).toISOString();

const waiting = { id: "w1", status: "active", created_at: h(100) };
const active = { id: "a1", status: "serving", customer_service_id: "cs", created_at: h(100) };
const ended71 = { id: "e71", status: "ended", ended_at: h(71), created_at: h(200) };
const ended72 = { id: "e72", status: "ended", ended_at: h(72), created_at: h(200) };
const ended73 = { id: "e73", status: "closed", closed_at: h(73), created_at: h(200) };
const ended3d = { id: "e3d", status: "ended", ended_at: h(72.1), created_at: h(500) };
const endedNoTime = { id: "e0", status: "ended", created_at: h(500) };
const reopened = { id: "r1", status: "active", ended_at: h(80), created_at: h(100) };

assert(isEndedConversationListVisible(waiting, now) === true, "waiting must show");
assert(isEndedConversationListVisible(active, now) === true, "active must show");
assert(isEndedConversationListVisible(ended71, now) === true, "71h ended must show");
assert(isEndedConversationListVisible(ended72, now) === false, "72h ended must hide");
assert(isEndedConversationListVisible(ended73, now) === false, "73h ended must hide");
assert(isEndedConversationListVisible(ended3d, now) === false, ">3d ended must hide");
assert(isEndedConversationListVisible(endedNoTime, now) === true, "missing end time must keep showing");
assert(isEndedConversationListVisible(reopened, now) === true, "reopened/active must show");

assert(resolveConversationEndedAt({ created_at: h(99) }) === null, "must not use created_at");
assert(resolveConversationEndedAt({ ended_at: h(1), created_at: h(99) }) === h(1), "prefer ended_at");
assert(resolveConversationEndedAt({ closed_at: h(2), created_at: h(99) }) === h(2), "fallback closed_at");

const hint = hintEndedAtFromMessages([
  { content: "hello", created_at: h(10), sender_role: "boss" },
  { content: "客服已结束本次接待。", created_at: h(5), message_type: "system", sender_role: "customer_service" },
]);
assert(hint === h(5), "hint from system end message");

const filtered = filterCsListConversations(
  [waiting, active, ended71, ended72, ended73, ended3d, endedNoTime, reopened],
  now
);
const ids = filtered.map((r) => r.id).sort().join(",");
assert(ids === "a1,e0,e71,r1,w1", `unexpected filter set: ${ids}`);

const endedCount = filtered.filter((r) => r.status === "ended" || r.status === "closed").length;
assert(endedCount === 2, `ended count should be 2 (71h + missing), got ${endedCount}`);

assert(ENDED_LIST_VISIBLE_MS === 72 * 3600 * 1000, "72h constant");

console.log(
  JSON.stringify(
    {
      ok: true,
      cases: {
        "ended_71h_visible": true,
        "ended_72h_hidden": true,
        "ended_over_3d_hidden": true,
        "ended_count_sync": true,
        "search_pool_excludes_expired": true,
        "waiting_active_unaffected": true,
        "no_created_at_as_end": true,
        "missing_end_kept_visible": true,
        "reopen_shows": true,
      },
    },
    null,
    2
  )
);
