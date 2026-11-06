/**
 * CS desk conversation list: hide ended sessions after 72h by verified end time.
 * Hide only — never delete rows or messages.
 */

export const ENDED_LIST_VISIBLE_MS = 72 * 60 * 60 * 1000;

export function isConversationEndedStatus(row = {}) {
  const raw = String(row.rawStatus || row.status || "").toLowerCase();
  if (raw === "closed" || raw === "ended") return true;
  return String(row.status || "") === "已结束";
}

/**
 * Resolve verified end time. Prefer ended_at, then closed_at / closedAt.
 * Never use created_at. Optional hintEndedAt may come from a verified system end message.
 */
export function resolveConversationEndedAt(row = {}, opts = {}) {
  const candidates = [
    row.ended_at,
    row.endedAt,
    row.closed_at,
    row.closedAt,
    opts.hintEndedAt,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const t = Date.parse(String(c));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

/** Infer end time from system end-reception messages (verified), never from create time. */
export function hintEndedAtFromMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i] || {};
    const type = String(m.message_type || m.messageType || m.type || "").toLowerCase();
    const role = String(m.sender_role || m.senderRole || "").toLowerCase();
    const content = String(m.content || m.text || "");
    const looksSystem = type === "system" || role === "system" || role === "customer_service";
    if (!looksSystem) continue;
    if (!/结束本次接待|会话已结束|已结束接待|结束接待/.test(content)) continue;
    const at = m.created_at || m.createdAt;
    if (!at) continue;
    const t = Date.parse(String(at));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

export function isEndedConversationListVisible(row = {}, nowMs = Date.now(), opts = {}) {
  if (!isConversationEndedStatus(row)) return true;
  const endedAt = resolveConversationEndedAt(row, opts);
  if (!endedAt) return true; // missing verified end time → keep showing
  const t = Date.parse(endedAt);
  if (!Number.isFinite(t)) return true;
  return nowMs - t < ENDED_LIST_VISIBLE_MS;
}

export function filterCsListConversations(rows, nowMs = Date.now(), optsById = null) {
  return (rows || []).filter((row) => {
    const id = row?.id;
    const opts = optsById && id && optsById[id] ? optsById[id] : {};
    return isEndedConversationListVisible(row, nowMs, opts);
  });
}

export function msUntilEndedListHide(row = {}, nowMs = Date.now(), opts = {}) {
  if (!isConversationEndedStatus(row)) return null;
  const endedAt = resolveConversationEndedAt(row, opts);
  if (!endedAt) return null;
  const t = Date.parse(endedAt);
  if (!Number.isFinite(t)) return null;
  const remain = t + ENDED_LIST_VISIBLE_MS - nowMs;
  return remain > 0 ? remain : 0;
}
