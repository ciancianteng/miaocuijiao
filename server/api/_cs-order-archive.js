/**
 * Soft-archive cancelled orders from the CS daily list.
 * Does NOT delete order rows, refunds, settlements, or status logs.
 * Marker lives in note/description (same pattern as COMPLETION_PENDING).
 */

export const CS_LIST_ARCHIVED_MARKER = "[[CS_LIST_ARCHIVED]]";

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readCsListArchive(row) {
  const blob = `${row?.note || ""}\n${row?.description || ""}`;
  if (!blob.includes(CS_LIST_ARCHIVED_MARKER)) return null;
  const re = new RegExp(`${escapeRe(CS_LIST_ARCHIVED_MARKER)}([^\\n]*)`, "i");
  const m = blob.match(re);
  let meta = {};
  try {
    const raw = String(m?.[1] || "").trim();
    if (raw) meta = JSON.parse(raw);
  } catch (_) {
    meta = {};
  }
  return {
    archived: true,
    at: meta.at || "",
    byId: meta.byId || "",
    byName: meta.byName || "",
    reason: meta.reason || "",
  };
}

export function isCsListArchived(row) {
  return !!readCsListArchive(row);
}

function upsertArchiveLine(text, payload) {
  const re = new RegExp(`\\n?${escapeRe(CS_LIST_ARCHIVED_MARKER)}[^\\n]*`, "gi");
  const cleaned = String(text || "").replace(re, "").trim();
  const line = `${CS_LIST_ARCHIVED_MARKER}${JSON.stringify(payload || {})}`;
  return cleaned ? `${cleaned}\n${line}` : line;
}

function stripArchiveLine(text) {
  const re = new RegExp(`\\n?${escapeRe(CS_LIST_ARCHIVED_MARKER)}[^\\n]*`, "gi");
  return String(text || "").replace(re, "").replace(/\n{2,}/g, "\n").trim();
}

/**
 * Soft-archive one cancelled order. Rejects non-cancelled / already archived.
 */
export async function archiveCancelledOrder(order, { operator, reason, patchOrder } = {}) {
  if (!order?.id) {
    const err = new Error("订单不存在。");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  const st = String(order.status || "").toLowerCase();
  if (st !== "cancelled") {
    const err = new Error("仅已取消订单可从客服列表移除记录。");
    err.status = 409;
    err.code = "NOT_CANCELLED";
    throw err;
  }
  if (isCsListArchived(order)) {
    return { ok: true, duplicate: true, order, message: "该订单已从日常列表移除。" };
  }
  const payload = {
    at: new Date().toISOString(),
    byId: operator?.id || "",
    byName: String(operator?.name || "").slice(0, 80),
    reason: String(reason || "客服移除已取消订单记录").slice(0, 200),
  };
  const nextNote = upsertArchiveLine(order.note || "", payload);
  const nextDesc = upsertArchiveLine(order.description || "", payload);
  let patched = null;
  if (typeof patchOrder === "function") {
    patched = await patchOrder(order.id, { note: nextNote, description: nextDesc }).catch(async () => {
      return patchOrder(order.id, { note: nextNote });
    });
  }
  return {
    ok: true,
    duplicate: false,
    order: patched || { ...order, note: nextNote, description: nextDesc },
    message: "已从客服日常列表移除（订单与财务记录保留，可在历史归档查看）。",
    archive: payload,
  };
}

export async function unarchiveCancelledOrder(order, { patchOrder } = {}) {
  if (!order?.id) {
    const err = new Error("订单不存在。");
    err.status = 404;
    err.code = "ORDER_NOT_FOUND";
    throw err;
  }
  if (!isCsListArchived(order)) {
    return { ok: true, duplicate: true, order, message: "订单未归档。" };
  }
  const nextNote = stripArchiveLine(order.note || "");
  const nextDesc = stripArchiveLine(order.description || "");
  let patched = null;
  if (typeof patchOrder === "function") {
    patched = await patchOrder(order.id, { note: nextNote, description: nextDesc }).catch(async () => {
      return patchOrder(order.id, { note: nextNote });
    });
  }
  return {
    ok: true,
    duplicate: false,
    order: patched || { ...order, note: nextNote, description: nextDesc },
    message: "已恢复到客服日常列表。",
  };
}

export function filterCsDailyOrders(orders, { includeArchived = false, archivedOnly = false } = {}) {
  const list = Array.isArray(orders) ? orders : [];
  if (archivedOnly) {
    return list.filter((o) => isCsListArchived(o) || o.csArchived === true);
  }
  if (includeArchived) return list;
  return list.filter((o) => !(isCsListArchived(o) || o.csArchived === true));
}
