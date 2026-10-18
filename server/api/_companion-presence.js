/** Companion presence writes. Page lifecycle must not change online_status. */

export function normalizePresenceStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "online" || raw === "busy" || raw === "paused" || raw === "offline") return raw;
  return "offline";
}

export function resolvePresenceKind(body = {}, status = "offline") {
  const kind = String(body.presenceKind || body.presence_kind || "").trim().toLowerCase();
  if (kind === "explicit" || kind === "heartbeat" || kind === "lifecycle") return kind;
  if (body.heartbeat === true || body.heartbeat === 1 || body.heartbeat === "1") return "heartbeat";
  if (body.lifecycle === true || body.lifecycle === 1 || body.pagehide === true || body.pagehide === 1) return "lifecycle";
  if (body.explicit === true || body.explicit === 1 || body.explicit === "1") return "explicit";
  // Old workbench beacons posted offline with no flag. The status button still posts online/busy/paused with no flag.
  if (status === "offline") return "lifecycle";
  return "explicit";
}

/**
 * @param {{ onlineStatus?: string, presenceRev?: number }} current
 * @param {Record<string, unknown>} body
 */
export function classifyPresenceWrite(current = {}, body = {}) {
  const status = normalizePresenceStatus(body.online_status || body.availability_status || body.status || "offline");
  const kind = resolvePresenceKind(body, status);
  const cur = normalizePresenceStatus(current.onlineStatus || current.online_status || "offline");
  const storedRev = Number(current.presenceRev ?? current.presence_rev) || 0;
  const rev = Number(body.presenceRev ?? body.presence_rev) || 0;
  const base = { presenceKind: kind, onlineStatus: cur, presenceRev: storedRev };

  if (kind === "lifecycle" || (status === "offline" && kind !== "explicit")) {
    return { ...base, write: false, code: "PRESENCE_LIFECYCLE_IGNORED" };
  }
  // Missing rev is a legacy client. Only a real older revision loses to a newer one.
  const stale = rev > 0 && storedRev > 0 && rev < storedRev;
  if (kind === "heartbeat") {
    if (cur === "offline") {
      return { ...base, write: false, code: "PRESENCE_HEARTBEAT_RESPECTS_OFFLINE" };
    }
    if (stale) return { ...base, write: false, code: "PRESENCE_STALE" };
    return {
      write: true,
      code: "PRESENCE_HEARTBEAT",
      presenceKind: kind,
      onlineStatus: status,
      presenceRev: rev || storedRev,
    };
  }
  if (stale) return { ...base, write: false, code: "PRESENCE_STALE" };
  return {
    write: true,
    code: "PRESENCE_EXPLICIT",
    presenceKind: "explicit",
    onlineStatus: status,
    presenceRev: rev || storedRev,
  };
}

export function presenceUpdatedAt(rev, now = Date.now()) {
  const n = Number(rev) || 0;
  if (n > 1e12 && n <= now + 60_000) return new Date(n).toISOString();
  return new Date(now).toISOString();
}

export async function loadCompanionPresence(userId, query) {
  const selects = [
    "online_status,availability_status,presence_rev,updated_at",
    "online_status,availability_status,updated_at",
    "online_status,updated_at",
    "online_status",
  ];
  for (const select of selects) {
    try {
      const rows = await query(select);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return { onlineStatus: "offline", presenceRev: 0 };
      const columnRev = Number(row.presence_rev) || 0;
      const updatedMs = Date.parse(row.updated_at || "");
      return {
        onlineStatus: row.availability_status || row.online_status || "offline",
        presenceRev: columnRev || (Number.isFinite(updatedMs) ? updatedMs : 0),
      };
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (!/42703|column|schema cache|PGRST204|does not exist/i.test(msg)) throw error;
    }
  }
  return { onlineStatus: "offline", presenceRev: 0, userId: userId || "" };
}

export async function savePresenceRev(rev, writeRev) {
  const n = Number(rev) || 0;
  if (!(n > 0) || typeof writeRev !== "function") return;
  try {
    await writeRev(n);
  } catch {
    /* presence_rev is optional until the column exists */
  }
}
