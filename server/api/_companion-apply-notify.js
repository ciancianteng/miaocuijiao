/**
 * Tell existing admin accounts that a companion application was submitted or supplemented.
 * One notice per admin per companion profile. Resubmit updates that notice and does not create another application.
 */

function authTypeLabel(authMode) {
  if (authMode === "id_card") return "身份证认证申请";
  if (authMode === "deposit") return "押金认证申请";
  return "入驻申请";
}

export async function notifyAdminsOfCompanionApplication(companionDb, {
  companionId = "",
  nickname = "",
  submittedAt = "",
  authMode = "",
} = {}) {
  const id = String(companionId || "").trim();
  if (!id || typeof companionDb !== "function") return { notified: 0 };
  let admins = [];
  try {
    admins = await companionDb(
      "profiles",
      "?or=(role.eq.admin,role.eq.super_admin)&select=id,role&limit=80"
    );
  } catch {
    admins = [];
  }
  const staffIds = [...new Set((Array.isArray(admins) ? admins : []).map((row) => String(row.id || "").trim()).filter(Boolean))];
  const name = String(nickname || "未命名申请人").trim() || "未命名申请人";
  const when = String(submittedAt || new Date().toISOString());
  const typeLabel = authTypeLabel(authMode);
  const title = "陪玩入驻待审核";
  const body = `${name} 于 ${when} 提交${typeLabel}，当前未审核。`;
  const href = "/admin.html#companion-applications";
  const noticeKey = `companion-apply-${id}`;
  let notified = 0;
  for (const staffId of staffIds) {
    const payload = {
      staff_id: staffId,
      notice_key: noticeKey,
      category: "companion_application",
      title,
      body,
      href,
      created_at: when,
    };
    try {
      await companionDb("staff_notifications", "", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(payload),
      });
      notified += 1;
    } catch {
      try {
        await companionDb(
          "staff_notifications",
          `?staff_id=eq.${encodeURIComponent(staffId)}&notice_key=eq.${encodeURIComponent(noticeKey)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ title, body, href, category: "companion_application" }),
          }
        );
        notified += 1;
      } catch {
        /* notification must not block the application write */
      }
    }
  }
  return { notified, pendingHref: href, typeLabel };
}
