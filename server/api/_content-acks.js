/**
 * Content acknowledgment (forced announcements / rules).
 * DB-backed; localStorage must never be the only source of truth.
 */
function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}
function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
async function sb(path, init = {}) {
  const response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const err = new Error(body?.message || body?.hint || (typeof body === "string" ? body : "") || `HTTP ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}
function missing(err) {
  return /PGRST205|Could not find the table|schema cache|content_ack|column/i.test(String(err?.message || err || ""));
}
function nowIso() {
  return new Date().toISOString();
}
function inWindow(row) {
  const now = Date.now();
  const start = row.start_at ? Date.parse(row.start_at) : NaN;
  const end = row.end_at ? Date.parse(row.end_at) : NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return true;
}

export async function listActiveForcedAnnouncements({ audience = "companion" } = {}) {
  try {
    const rows = await sb(
      rest(
        "announcements",
        `?is_active=eq.true&kind=eq.forced&order=is_pinned.desc,sort_order.asc,published_at.desc&limit=50`
      )
    );
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      if (!inWindow(row)) return false;
      const aud = String(row.audience || row.category || "companion").toLowerCase();
      if (audience === "all") return true;
      if (audience === "boss" || audience === "home" || audience === "homepage") {
        return (
          aud === "boss" ||
          aud === "home" ||
          aud === "homepage" ||
          aud === "all" ||
          aud === "customer"
        );
      }
      if (audience === "companion" || audience === "player") {
        return aud === "companion" || aud === "player" || aud === "all";
      }
      if (audience === "customer_service" || audience === "cs") {
        return aud === "customer_service" || aud === "cs" || aud === "all";
      }
      return aud === audience || aud === "all";
    });
  } catch (err) {
    if (missing(err)) return [];
    // kind column may be missing — treat none as forced
    if (/kind|requires_ack|content_version/i.test(String(err.message || ""))) return [];
    throw err;
  }
}

export async function getAck(userId, contentType, contentId, contentVersion) {
  try {
    const rows = await sb(
      rest(
        "content_ack_records",
        `?user_id=eq.${encodeURIComponent(userId)}&content_type=eq.${encodeURIComponent(contentType)}&content_id=eq.${encodeURIComponent(contentId)}&content_version=eq.${encodeURIComponent(String(contentVersion))}&limit=1`
      )
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

export async function pendingForcedForUser(userId, { audience = "companion" } = {}) {
  const pending = [];
  const forced = await listActiveForcedAnnouncements({ audience });
  for (const row of forced) {
    if (row.requires_ack === false) continue;
    const ver = String(row.content_version || 1);
    const ack = await getAck(userId, "announcement", String(row.id), ver);
    if (!ack || ack.status !== "acked" || ack.revoked || ack.expired) {
      pending.push({
        id: row.id,
        contentType: "announcement",
        title: row.title || "强制公告",
        content: row.content || "",
        version: ver,
        kind: "forced",
        audience: row.audience || audience,
        publishedAt: row.published_at || row.updated_at || "",
        updatedAt: row.updated_at || "",
        startAt: row.start_at || "",
        endAt: row.end_at || "",
      });
    }
  }

  // Companion work rules with forceConfirm / requiresAck
  if (audience === "companion" || audience === "all") {
    try {
      const { listWorkRules } = await import("./_companion-work-rules.js");
      const rules = await listWorkRules({ includeDisabled: false });
      for (const rule of rules) {
        if (!rule.forceConfirm) continue;
        const ver = String(rule.version || 1);
        const ack = await getAck(userId, "companion_work_rules", String(rule.id), ver);
        if (!ack || ack.status !== "acked" || ack.revoked || ack.expired) {
          pending.push({
            id: rule.id,
            contentType: "companion_work_rules",
            title: rule.title || rule.category || "陪玩规则",
            content: rule.body || rule.content || "",
            version: ver,
            kind: "work_rule",
            audience: "companion",
            publishedAt: rule.publishedAt || "",
            updatedAt: rule.updatedAt || "",
          });
        }
      }
    } catch {
      /* table may be missing */
    }
  }

  // Boss / user platform player_rules with forceConfirm
  if (audience === "boss" || audience === "home" || audience === "all") {
    try {
      const rows = await sb(
        rest(
          "platform_content_items",
          `?type=eq.player_rules&status=eq.published&enabled=eq.true&order=sort.asc&limit=20`
        )
      );
      for (const row of Array.isArray(rows) ? rows : []) {
        const data = { ...(row.published || {}), ...(row.draft || {}) };
        if (data.forceConfirm !== true && data.requiresAck !== true) continue;
        // Apply-step institution is for applicants; platform-usage is for boss
        if (String(row.slug || "") === "apply-step1" && audience !== "all") continue;
        const ver = String(data.version || row.version || 1);
        const ack = await getAck(userId, "player_rules", String(row.id), ver);
        if (!ack || ack.status !== "acked" || ack.revoked || ack.expired) {
          pending.push({
            id: row.id,
            contentType: "player_rules",
            title: data.title || row.title || "平台使用规则",
            content: data.body || data.content || "",
            version: ver,
            kind: "player_rules",
            audience: "boss",
            publishedAt: row.published_at || "",
            updatedAt: row.updated_at || "",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return pending;
}

export async function acknowledgeContent({
  userId,
  contentType,
  contentId,
  contentVersion,
  effectiveAt = "",
  contentUpdatedAt = "",
  ip = "",
  userAgent = "",
} = {}) {
  if (!userId || !contentType || !contentId || contentVersion == null) {
    throw Object.assign(new Error("缺少确认参数"), { status: 400 });
  }
  const row = {
    user_id: userId,
    content_type: contentType,
    content_id: String(contentId),
    content_version: String(contentVersion),
    status: "acked",
    acknowledged_at: nowIso(),
    effective_at: effectiveAt || nowIso(),
    content_updated_at: contentUpdatedAt || nowIso(),
    ip: String(ip || "").slice(0, 120),
    user_agent: String(userAgent || "").slice(0, 300),
    revoked: false,
    expired: false,
    updated_at: nowIso(),
  };
  try {
    const existing = await getAck(userId, contentType, contentId, contentVersion);
    if (existing?.id) {
      const patched = await sb(rest("content_ack_records", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        body: JSON.stringify(row),
      });
      return Array.isArray(patched) ? patched[0] : patched;
    }
    const created = await sb(rest("content_ack_records"), {
      method: "POST",
      body: JSON.stringify({ ...row, created_at: nowIso() }),
    });
    return Array.isArray(created) ? created[0] : created;
  } catch (err) {
    if (/duplicate|unique|23505/i.test(String(err.message || ""))) {
      return getAck(userId, contentType, contentId, contentVersion);
    }
    if (missing(err)) {
      throw Object.assign(new Error("阅读确认表未创建，请执行 rules_hub_acks 迁移。"), { status: 503 });
    }
    throw err;
  }
}

export async function assertCompanionCanWork(userId) {
  const pending = await pendingForcedForUser(userId, { audience: "companion" });
  if (pending.length) {
    throw Object.assign(
      new Error("请先阅读并确认最新强制公告后，才能切换状态、抢单或接单。"),
      { status: 403, code: "FORCED_ACK_REQUIRED", pending }
    );
  }
  return true;
}

export async function listAckRecords({ status = "", companionId = "", limit = 200 } = {}) {
  let q = `?order=acknowledged_at.desc.nullslast,created_at.desc&limit=${Math.min(500, Math.max(1, Number(limit) || 200))}`;
  if (companionId) q += `&user_id=eq.${encodeURIComponent(companionId)}`;
  if (status === "acked") q += `&status=eq.acked`;
  if (status === "revoked") q += `&revoked=eq.true`;
  if (status === "expired") q += `&expired=eq.true`;
  try {
    const rows = await sb(rest("content_ack_records", q));
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (missing(err)) return [];
    throw err;
  }
}

export async function companionsNeedingAck() {
  const forced = await listActiveForcedAnnouncements({ audience: "companion" });
  if (!forced.length) return { forced, companions: [], pendingPairs: [] };
  let companions = [];
  try {
    companions = await sb(rest("profiles", `?role=eq.companion&select=id,display_name,email,status&order=created_at.desc&limit=500`));
  } catch {
    companions = [];
  }
  const acks = await listAckRecords({ limit: 500 });
  const ackKey = new Set(
    acks
      .filter((a) => a.status === "acked" && !a.revoked && !a.expired)
      .map((a) => `${a.user_id}|${a.content_id}|${a.content_version}`)
  );
  const pendingPairs = [];
  for (const c of Array.isArray(companions) ? companions : []) {
    for (const f of forced) {
      const ver = String(f.content_version || 1);
      const key = `${c.id}|${f.id}|${ver}`;
      if (!ackKey.has(key)) {
        pendingPairs.push({
          companionId: c.id,
          companionName: c.display_name || c.email || c.id,
          companionStatus: c.status || "",
          contentId: f.id,
          contentTitle: f.title || "",
          contentVersion: ver,
          status: "unread",
          needsReconfirm: true,
        });
      }
    }
  }
  return { forced, companions: companions || [], pendingPairs };
}
