/**
 * Staff (客服) inbox fan-out on staff_notifications.
 * One row per staff per (kind, related_id) while unread, so retries / resubmits do not stack.
 */
import { companionDb, isMissingRelation } from "./_companion-media-store.js";

const COLUMN_ERR = /column|PGRST204|schema cache/i;

export async function listActiveCustomerServiceIds() {
  const rows = await companionDb(
    "profiles",
    "?role=eq.customer_service&status=eq.active&select=id&limit=200"
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((r) => r?.id).filter(Boolean);
}

async function hasUnread(staffId, kind, relatedId) {
  const rows = await companionDb(
    "staff_notifications",
    `?staff_id=eq.${encodeURIComponent(staffId)}&kind=eq.${encodeURIComponent(kind)}&related_id=eq.${encodeURIComponent(
      relatedId
    )}&read_at=is.null&select=id&limit=1`
  ).catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function insertRow(row, extended) {
  try {
    await companionDb("staff_notifications", "", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...row, ...extended }),
    });
    return true;
  } catch (err) {
    if (isMissingRelation(err) && !COLUMN_ERR.test(String(err?.message || ""))) return false;
    if (!COLUMN_ERR.test(String(err?.message || ""))) throw err;
  }
  await companionDb("staff_notifications", "", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  return true;
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
      const ok = await insertRow(
        { staff_id: staffId, title: String(title || "系统通知"), body: String(body || ""), kind: k, related_id: rid },
        { category: k, href: String(href || ""), notice_key: `${k}:${rid}:${staffId}` }
      );
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
  const rows = await companionDb(
    "staff_notifications",
    `?staff_id=eq.${encodeURIComponent(id)}&kind=in.(${list.map(encodeURIComponent).join(",")})&read_at=is.null`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    }
  ).catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}
