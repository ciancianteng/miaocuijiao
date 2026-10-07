/**
 * Staff (客服) inbox fan-out on staff_notifications.
 * One row per staff per (kind, related id) while that notice is still unread.
 *
 * Staging's table was created for payroll notices (notice_key / category / href)
 * and does not have kind / related_id. The migration-shaped table has the opposite
 * columns. Inserts drop whichever columns PostgREST says are missing, so one
 * submission still lands exactly once.
 */
import { companionDb, isMissingRelation } from "./_companion-media-store.js";

const COLUMN_ERR = /column|PGRST204|schema cache/i;

function missingColumn(err) {
  const message = `${err?.message || ""} ${JSON.stringify(err?.body || "")}`;
  const named = message.match(/Could not find the '([^']+)' column/i);
  return named ? named[1] : "";
}

function columnMismatch(err) {
  return Boolean(missingColumn(err)) || (COLUMN_ERR.test(`${err?.message || ""} ${JSON.stringify(err?.body || "")}`) && !/Could not find the table/i.test(String(err?.message || "")));
}

export async function listActiveCustomerServiceIds() {
  const rows = await companionDb(
    "profiles",
    "?role=eq.customer_service&status=eq.active&select=id&limit=200"
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((r) => r?.id).filter(Boolean);
}

async function lookupRows(query) {
  const rows = await companionDb("staff_notifications", query);
  return Array.isArray(rows) ? rows : [];
}

/** True when this staff already has an unread notice for the same submission. */
async function hasUnread(staffId, kind, relatedId) {
  const key = `${kind}:${relatedId}:${staffId}`;
  const e = encodeURIComponent;
  const tries = [
    `?staff_id=eq.${e(staffId)}&notice_key=eq.${e(key)}&read_at=is.null&select=id&limit=1`,
    `?staff_id=eq.${e(staffId)}&kind=eq.${e(kind)}&related_id=eq.${e(relatedId)}&read_at=is.null&select=id&limit=1`,
    `?staff_id=eq.${e(staffId)}&notice_key=eq.${e(key)}&select=id&limit=1`,
    `?staff_id=eq.${e(staffId)}&kind=eq.${e(kind)}&related_id=eq.${e(relatedId)}&select=id&limit=1`,
  ];
  for (const query of tries) {
    try {
      const rows = await lookupRows(query);
      return rows.length > 0;
    } catch (err) {
      if (columnMismatch(err) || isMissingRelation(err)) continue;
      console.warn("[staff-notify] lookup", err?.message || err);
      return false;
    }
  }
  return false;
}

async function insertAdaptive(payload) {
  const row = { ...payload };
  for (let i = 0; i < 8; i += 1) {
    if (!row.staff_id || !row.title) return false;
    try {
      await companionDb("staff_notifications", "", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(row),
      });
      return true;
    } catch (err) {
      const col = missingColumn(err);
      if (col && Object.prototype.hasOwnProperty.call(row, col)) {
        delete row[col];
        continue;
      }
      if (isMissingRelation(err) && !columnMismatch(err)) return false;
      if (!columnMismatch(err)) throw err;
    }
  }
  return false;
}

/**
 * @param {{ kind: string, relatedId: string, title: string, body?: string, href?: string, staffIds?: string[] }} n
 * @returns {Promise<{ inserted: number, skipped: number }>}
 */
export async function notifyCustomerServiceStaff({ kind, relatedId, title, body = "", href = "", staffIds = null }) {
  const k = String(kind || "").trim();
  const rid = String(relatedId || "").trim();
  if (!k || !rid) return { inserted: 0, skipped: 0 };
  const ids = Array.isArray(staffIds) ? staffIds.filter(Boolean) : await listActiveCustomerServiceIds();
  let inserted = 0;
  let skipped = 0;
  for (const staffId of ids) {
    try {
      if (await hasUnread(staffId, k, rid)) {
        skipped += 1;
        continue;
      }
      const ok = await insertAdaptive({
        staff_id: staffId,
        title: String(title || "系统通知"),
        body: String(body || ""),
        kind: k,
        related_id: rid,
        category: k,
        href: String(href || ""),
        notice_key: `${k}:${rid}:${staffId}`,
      });
      if (!ok) continue;
      inserted += 1;
      try {
        const { fanoutWebPush } = await import("./_web-push.js");
        fanoutWebPush(staffId, {
          title: String(title || "系统通知"),
          body: String(body || ""),
          url: String(href || "/customer-service/"),
          notificationType: k,
          entityId: rid,
          tag: `staff-${k}-${rid}`,
        });
      } catch {
        /* push optional */
      }
    } catch (err) {
      console.warn("[staff-notify]", k, rid, err?.message || err);
    }
  }
  return { inserted, skipped };
}

/** Mark unread staff notices of the given kinds as read for one staff member. */
export async function markStaffNotificationsRead(staffId, kinds = []) {
  const id = String(staffId || "").trim();
  const list = (Array.isArray(kinds) ? kinds : [kinds]).map((k) => String(k || "").trim()).filter(Boolean);
  if (!id || !list.length) return 0;
  const stamp = { read_at: new Date().toISOString() };
  const filters = [
    `?staff_id=eq.${encodeURIComponent(id)}&kind=in.(${list.map(encodeURIComponent).join(",")})&read_at=is.null`,
    `?staff_id=eq.${encodeURIComponent(id)}&category=in.(${list.map(encodeURIComponent).join(",")})&read_at=is.null`,
  ];
  for (const query of filters) {
    try {
      const rows = await companionDb("staff_notifications", query, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(stamp),
      });
      return Array.isArray(rows) ? rows.length : 0;
    } catch (err) {
      if (columnMismatch(err) || isMissingRelation(err)) continue;
      return 0;
    }
  }
  return 0;
}
