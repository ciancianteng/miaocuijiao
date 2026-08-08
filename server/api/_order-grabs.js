/** Multi-applicant grab records: order_grabs table, with note/description marker fallback. */

const GRAB_NOTE_START = "[[ORDER_GRABS]]";
const GRAB_NOTE_END = "[[/ORDER_GRABS]]";
const COMPLETION_PENDING_MARKER = "[[COMPLETION_PENDING]]";
const COMPLETION_REQUESTED_AT_MARKER = "[[COMPLETION_REQUESTED_AT]]";

function nowIso() {
  return new Date().toISOString();
}

function orderBlobSource(order = {}) {
  // Union both fields so pay-note + description markers are both visible.
  const note = String(order.note || "");
  const description = String(order.description || "");
  if (note && description) return `${note}\n${description}`;
  return note || description;
}

function orderHasCompletionPending(order = {}) {
  return (
    hasCompletionPending(String(order.note || "")) ||
    hasCompletionPending(String(order.description || ""))
  );
}

function parseGrabBlob(text = "") {
  const raw = String(text || "");
  const start = raw.indexOf(GRAB_NOTE_START);
  const end = raw.indexOf(GRAB_NOTE_END);
  if (start === -1 || end === -1 || end <= start) return { grabs: [], rest: raw };
  const json = raw.slice(start + GRAB_NOTE_START.length, end).trim();
  let grabs = [];
  try {
    grabs = JSON.parse(json);
    if (!Array.isArray(grabs)) grabs = [];
  } catch {
    grabs = [];
  }
  const rest = (raw.slice(0, start) + raw.slice(end + GRAB_NOTE_END.length)).trim();
  return { grabs, rest };
}

function serializeGrabNote(rest, grabs) {
  const body = `${GRAB_NOTE_START}${JSON.stringify(grabs)}${GRAB_NOTE_END}`;
  return rest ? `${rest}\n${body}` : body;
}

function hasCompletionPending(text = "") {
  return String(text || "").includes(COMPLETION_PENDING_MARKER);
}

function parseCompletionRequestedAtText(text = "") {
  const hit = String(text || "").match(/\[\[COMPLETION_REQUESTED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim()))) return hit[1].trim();
  return "";
}

function withCompletionPending(text = "", atIso = nowIso()) {
  let raw = withoutCompletionPending(String(text || ""));
  const block = `${COMPLETION_PENDING_MARKER}\n${COMPLETION_REQUESTED_AT_MARKER}${atIso}`;
  return raw ? `${raw}\n${block}` : block;
}

function withoutCompletionPending(text = "") {
  return String(text || "")
    .replace(/\[\[COMPLETION_PENDING(?::[^\]]*)?\]\]/gi, "")
    .replace(/\[\[COMPLETION_REQUESTED_AT\]\][^\n]*/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Strip internal grab / completion markers so companions never see raw JSON blobs. */
export function stripInternalOrderMarkers(text = "") {
  let raw = String(text || "");
  // Prefer closed marker blocks; also drop truncated open blobs (legacy bad rows).
  raw = raw.replace(/\[\[ORDER_GRABS\]\][\s\S]*?\[\[\/ORDER_GRABS\]\]/g, "");
  raw = raw.replace(/\[\[ORDER_GRABS\]\][\s\S]*$/g, "");
  raw = withoutCompletionPending(raw);
  raw = raw
    .replace(/\[\[COMPLETION_METHOD\]\][^\n]*/gi, "")
    .replace(/\[\[COMPLETION_AUTO_PAUSED\]\][^\n]*/gi, "")
    .replace(/\[\[ORDER_DISPUTE\]\][^\n]*/gi, "")
    .replace(/\[\[ORDER_FROZEN\]\][^\n]*/gi, "");
  return raw.replace(/\n{2,}/g, "\n").trim();
}

/** Grab rows that boss/CS may still choose (exclude rejected/withdrawn losers). */
export function isSelectableGrabStatus(status) {
  const s = String(status || "pending_customer_selection").toLowerCase().trim();
  if (!s) return true;
  if (["not_selected", "withdrawn", "cancelled", "canceled", "rejected", "expired", "lost"].includes(s)) {
    return false;
  }
  // pending_customer_selection | pending | grabbed | selected | active | …
  return true;
}

export function createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders }) {
  async function patchOrderText(orderId, nextText, preferNote = true) {
    const attempts = preferNote
      ? [{ note: nextText }, { description: nextText }]
      : [{ description: nextText }, { note: nextText }];
    let lastErr = null;
    for (const body of attempts) {
      try {
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
        return Object.keys(body)[0];
      } catch (err) {
        lastErr = err;
        if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
      }
    }
    throw lastErr || new Error("无法写入抢单/完成标记");
  }

  async function listGrabsFromTable(orderId) {
    const rows = await supabaseJson(
      restUrl("order_grabs", `?order_id=eq.${encodeURIComponent(orderId)}&order=grabbed_at.asc&limit=80`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  }

  /** Batch load grabs for many orders in one (or few chunked) REST calls. */
  async function listGrabsBatch(orderIds = [], orderNoteById = {}) {
    const ids = [...new Set((orderIds || []).map(String).filter(Boolean))];
    const byOrder = Object.fromEntries(ids.map((id) => [id, []]));
    if (!ids.length) return byOrder;
    const chunkSize = 40;
    try {
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const rows = await supabaseJson(
          restUrl(
            "order_grabs",
            `?order_id=in.(${chunk.map(encodeURIComponent).join(",")})&order=grabbed_at.asc&limit=800`
          ),
          { headers: serviceHeaders() }
        );
        (Array.isArray(rows) ? rows : []).forEach((r) => {
          const oid = String(r.order_id || "");
          if (!byOrder[oid]) byOrder[oid] = [];
          byOrder[oid].push({
            id: r.id,
            grabId: r.id,
            orderId: r.order_id,
            companionId: r.companion_id,
            status: r.status || "pending_customer_selection",
            grabbedAt: r.grabbed_at || "",
          });
        });
      }
    } catch {
      /* fall through to per-order / note blob */
    }
    await Promise.all(
      ids.map(async (id) => {
        if (byOrder[id] && byOrder[id].length) return;
        try {
          byOrder[id] = await listGrabs(id, orderNoteById[id] || "");
        } catch {
          byOrder[id] = [];
        }
      })
    );
    return byOrder;
  }

  async function listGrabs(orderId, orderNote = "") {
    try {
      const rows = await listGrabsFromTable(orderId);
      if (rows.length) {
        return rows.map((r) => ({
          id: r.id,
          grabId: r.id,
          orderId: r.order_id,
          companionId: r.companion_id,
          status: r.status || "pending_customer_selection",
          grabbedAt: r.grabbed_at || "",
        }));
      }
    } catch {
      /* fall through */
    }
    const { grabs } = parseGrabBlob(orderNote);
    return grabs.map((g) => ({
      id: g.id || `${orderId}:${g.companion_id}`,
      grabId: g.id || `${orderId}:${g.companion_id}`,
      orderId,
      companionId: g.companion_id,
      status: g.status || "pending_customer_selection",
      grabbedAt: g.grabbed_at || "",
    }));
  }

  async function insertGrab(order, companionId) {
    const orderId = order.id;
    const blob = orderBlobSource(order);
    const existing = await listGrabs(orderId, blob);
    const mine = existing.find((g) => g.companionId === companionId);
    if (mine) {
      return { grab: mine, created: false, grabs: existing };
    }
    const grabbedAt = nowIso();
    try {
      const rows = await supabaseJson(restUrl("order_grabs"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          order_id: orderId,
          companion_id: companionId,
          status: "pending_customer_selection",
          grabbed_at: grabbedAt,
        }),
      });
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        return {
          grab: {
            id: row.id,
            grabId: row.id,
            orderId,
            companionId,
            status: row.status || "pending_customer_selection",
            grabbedAt: row.grabbed_at || grabbedAt,
          },
          created: true,
          grabs: await listGrabs(orderId, blob),
        };
      }
    } catch (err) {
      if (!/relation|schema cache|does not exist|duplicate|unique|PGRST/i.test(String(err?.message || err || ""))) {
        throw err;
      }
    }
    const { grabs, rest } = parseGrabBlob(blob);
    if (grabs.some((g) => g.companion_id === companionId)) {
      const again = await listGrabs(orderId, blob);
      return { grab: again.find((g) => g.companionId === companionId), created: false, grabs: again };
    }
    const grab = {
      id: `note-${companionId}-${Date.now()}`,
      companion_id: companionId,
      status: "pending_customer_selection",
      grabbed_at: grabbedAt,
    };
    grabs.push(grab);
    await patchOrderText(orderId, serializeGrabNote(rest, grabs));
    return {
      grab: {
        id: grab.id,
        grabId: grab.id,
        orderId,
        companionId,
        status: grab.status,
        grabbedAt,
      },
      created: true,
      grabs: grabs.map((g) => ({
        id: g.id,
        grabId: g.id,
        orderId,
        companionId: g.companion_id,
        status: g.status,
        grabbedAt: g.grabbed_at || "",
      })),
    };
  }

  async function finalizeGrabSelection(order, selectedCompanionId) {
    const orderId = order.id;
    const stamp = nowIso();
    let usedTable = false;
    try {
      const all = await listGrabsFromTable(orderId);
      if (all.length) {
        usedTable = true;
        for (const row of all) {
          const selected = row.companion_id === selectedCompanionId;
          const next = selected ? "selected" : "not_selected";
          if (row.status !== next) {
            const body = { status: next };
            // Soft columns — ignore if migration not applied.
            if (selected) body.selected_at = stamp;
            else body.rejected_at = stamp;
            try {
              await supabaseJson(restUrl("order_grabs", `?id=eq.${encodeURIComponent(row.id)}`), {
                method: "PATCH",
                headers: serviceHeaders(),
                body: JSON.stringify(body),
              });
            } catch {
              await supabaseJson(restUrl("order_grabs", `?id=eq.${encodeURIComponent(row.id)}`), {
                method: "PATCH",
                headers: serviceHeaders(),
                body: JSON.stringify({ status: next }),
              });
            }
          }
        }
      }
    } catch {
      usedTable = false;
    }
    if (!usedTable) {
      const blob = orderBlobSource(order);
      const { grabs, rest } = parseGrabBlob(blob);
      const nextGrabs = grabs.map((g) => ({
        ...g,
        status: g.companion_id === selectedCompanionId ? "selected" : "not_selected",
        selected_at: g.companion_id === selectedCompanionId ? stamp : g.selected_at || null,
        rejected_at: g.companion_id === selectedCompanionId ? null : stamp,
      }));
      await patchOrderText(orderId, serializeGrabNote(rest, nextGrabs));
    }
    return listGrabs(orderId, orderBlobSource(order));
  }

  async function countGrabs(orderId, orderNote = "") {
    const grabs = await listGrabs(orderId, orderNote);
    return grabs.length;
  }

  async function listMyPendingGrabs(companionId) {
    try {
      const rows = await supabaseJson(
        restUrl(
          "order_grabs",
          `?companion_id=eq.${encodeURIComponent(companionId)}&status=eq.pending_customer_selection&order=grabbed_at.desc&limit=100`
        ),
        { headers: serviceHeaders() }
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async function markCompletionPending(order) {
    const existingAt =
      parseCompletionRequestedAtText(String(order.note || "")) ||
      parseCompletionRequestedAtText(String(order.description || ""));
    if (orderHasCompletionPending(order) && existingAt) {
      return orderBlobSource(order);
    }
    const atIso = nowIso();
    // Dual-write marker to BOTH note and description.
    // Boss order list sometimes falls back to a select without `note`; description is always selected,
    // so the boss UI must still see completionPending=true after companion applies.
    const noteBase = String(order.note || "");
    const descBase = String(order.description || "");
    const nextNote = withCompletionPending(noteBase, atIso);
    const nextDesc = withCompletionPending(descBase, atIso);
    const attempts = [
      { note: nextNote, description: nextDesc },
      { description: nextDesc },
      { note: nextNote },
    ];
    let lastErr = null;
    for (const body of attempts) {
      try {
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
        return orderBlobSource({ note: nextNote, description: nextDesc });
      } catch (err) {
        lastErr = err;
        if (!/column|schema cache|PGRST|note|description/i.test(String(err?.message || ""))) throw err;
      }
    }
    throw lastErr || new Error("无法写入完成申请标记");
  }

  async function clearCompletionPending(order) {
    if (!orderHasCompletionPending(order)) return orderBlobSource(order);
    const patches = [];
    if (hasCompletionPending(String(order.note || ""))) {
      patches.push({ note: withoutCompletionPending(String(order.note || "")) });
    }
    if (hasCompletionPending(String(order.description || ""))) {
      patches.push({ description: withoutCompletionPending(String(order.description || "")) });
    }
    if (!patches.length) {
      patches.push({ description: withoutCompletionPending(orderBlobSource(order)) });
    }
    for (const body of patches) {
      try {
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
      }
    }
    return withoutCompletionPending(orderBlobSource(order));
  }

  return {
    listGrabs,
    listGrabsBatch,
    insertGrab,
    finalizeGrabSelection,
    countGrabs,
    listMyPendingGrabs,
    hasCompletionPending,
    withCompletionPending,
    withoutCompletionPending,
    markCompletionPending,
    clearCompletionPending,
    orderHasCompletionPending,
    orderBlobSource,
    isSelectableGrabStatus,
    COMPLETION_PENDING_MARKER,
  };
}
