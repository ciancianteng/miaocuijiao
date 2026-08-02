/**
 * Companion work rules (陪玩规则分类) stored in platform_content_items.
 * type = companion_work_rules
 */
const TYPE = "companion_work_rules";

export const DEFAULT_RULE_CATEGORIES = [
  { category: "接单规则", title: "接单规则", sort: 1 },
  { category: "服务态度", title: "服务态度", sort: 2 },
  { category: "回复时效", title: "回复时效", sort: 3 },
  { category: "禁止私下交易", title: "禁止私下交易", sort: 4 },
  { category: "禁止辱骂、冷落老板", title: "禁止辱骂、冷落老板", sort: 5 },
  { category: "迟到、失联和跳单处理", title: "迟到、失联和跳单处理", sort: 6 },
  { category: "订单开始和结束规则", title: "订单开始和结束规则", sort: 7 },
  { category: "退款及投诉规则", title: "退款及投诉规则", sort: 8 },
  { category: "账号处罚规则", title: "账号处罚规则", sort: 9 },
  { category: "降级、停权和封号规则", title: "降级、停权和封号规则", sort: 10 },
  { category: "猫粮、收益和提现规则", title: "猫粮、收益和提现规则", sort: 11 },
  { category: "隐私及联系方式规则", title: "隐私及联系方式规则", sort: 12 },
];

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
    const err = new Error(body?.message || body?.hint || `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return body;
}
function missing(err) {
  return /PGRST205|Could not find the table|schema cache/i.test(String(err?.message || err || ""));
}
function nowIso() {
  return new Date().toISOString();
}
function mapItem(row = {}) {
  const draft = row.draft && typeof row.draft === "object" ? row.draft : {};
  const published = row.published && typeof row.published === "object" ? row.published : {};
  const data = { ...published, ...draft };
  const enabled = row.enabled !== false && String(row.status || "") !== "disabled";
  return {
    id: row.id,
    type: TYPE,
    title: data.title || row.title || "",
    category: data.category || data.title || "",
    body: data.body || data.content || "",
    content: data.body || data.content || "",
    sort: Number(row.sort ?? data.sort ?? 100),
    enabled,
    forceConfirm: data.forceConfirm === true || data.requiresAck === true,
    effectiveAt: data.effectiveAt || data.effective_at || row.published_at || "",
    version: String(data.version || row.version || 1),
    updatedAt: row.updated_at || "",
    publishedAt: row.published_at || "",
    status: row.status || (enabled ? "published" : "draft"),
  };
}

export async function listWorkRules({ includeDisabled = false } = {}) {
  try {
    const rows = await sb(rest("platform_content_items", `?type=eq.${TYPE}&order=sort.asc,updated_at.desc&limit=100`));
    return (Array.isArray(rows) ? rows : [])
      .map(mapItem)
      .filter((item) => includeDisabled || item.enabled);
  } catch (err) {
    if (missing(err)) return [];
    throw err;
  }
}

export async function ensureDefaultWorkRules() {
  const existing = await listWorkRules({ includeDisabled: true });
  if (existing.length) return existing;
  const created = [];
  for (const cat of DEFAULT_RULE_CATEGORIES) {
    const id = `pc-work-rule-${cat.sort}`;
    const payload = {
      id,
      type: TYPE,
      slug: `rule-${cat.sort}`,
      title: cat.title,
      status: "published",
      enabled: true,
      sort: cat.sort,
      draft: {
        title: cat.title,
        category: cat.category,
        body: `（后台可编辑）${cat.title}正文。请管理员填写正式条款。`,
        sort: cat.sort,
        forceConfirm: false,
        version: "1",
        effectiveAt: nowIso(),
      },
      published: {
        title: cat.title,
        category: cat.category,
        body: `（后台可编辑）${cat.title}正文。请管理员填写正式条款。`,
        sort: cat.sort,
        forceConfirm: false,
        version: "1",
        effectiveAt: nowIso(),
      },
      version: 1,
      published_at: nowIso(),
      updated_at: nowIso(),
    };
    try {
      const rows = await sb(rest("platform_content_items"), { method: "POST", body: JSON.stringify(payload) });
      created.push(mapItem(Array.isArray(rows) ? rows[0] : rows));
    } catch (err) {
      if (/duplicate|unique|23505/i.test(String(err.message || ""))) continue;
      if (missing(err)) return [];
    }
  }
  return created.length ? created : listWorkRules({ includeDisabled: true });
}

export async function saveWorkRule(input = {}, adminId = "admin") {
  const id = String(input.id || "").trim();
  const title = String(input.title || input.category || "").trim();
  const category = String(input.category || title).trim();
  const body = String(input.body || input.content || "").trim();
  if (!title) throw Object.assign(new Error("请填写规则标题"), { status: 400 });
  if (!body) throw Object.assign(new Error("请填写规则正文"), { status: 400 });
  const prev = id
    ? (await listWorkRules({ includeDisabled: true })).find((r) => String(r.id) === id)
    : null;
  let version = String(input.version || prev?.version || "1");
  if (prev && (prev.body !== body || prev.title !== title)) {
    const n = Number(prev.version) || 1;
    version = String(n + 1);
  }
  const data = {
    title,
    category,
    body,
    content: body,
    sort: Number(input.sort ?? prev?.sort ?? 100),
    forceConfirm: input.forceConfirm === true || input.forceConfirm === "true",
    version,
    effectiveAt: input.effectiveAt || prev?.effectiveAt || nowIso(),
  };
  const enabled = input.enabled !== false && input.enabled !== "false";
  const row = {
    type: TYPE,
    slug: String(input.slug || `rule-${Date.now()}`),
    title,
    status: "published",
    enabled,
    sort: data.sort,
    draft: data,
    published: data,
    version: Number(version) || 1,
    published_by: adminId,
    published_at: nowIso(),
    updated_by: adminId,
    updated_at: nowIso(),
  };
  if (id) {
    const patched = await sb(rest("platform_content_items", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    return mapItem(Array.isArray(patched) ? patched[0] : patched);
  }
  const created = await sb(rest("platform_content_items"), {
    method: "POST",
    body: JSON.stringify({ ...row, id: `pc-work-rule-${Date.now()}` }),
  });
  return mapItem(Array.isArray(created) ? created[0] : created);
}

export async function loadClubLevelGuide() {
  try {
    const rows = await sb(
      rest("platform_content_items", `?type=eq.club_level_guide&slug=eq.default&limit=1`)
    );
    const item = Array.isArray(rows) ? rows[0] : null;
    if (!item) {
      return {
        title: "俱乐部等级说明",
        intro: "了解妙脆角俱乐部陪玩等级、价格区间、升级与权益。",
        updatedAt: "",
      };
    }
    const data = { ...(item.published || {}), ...(item.draft || {}) };
    return {
      title: data.title || item.title || "俱乐部等级说明",
      intro: data.intro || data.description || "",
      updatedAt: item.updated_at || item.published_at || "",
    };
  } catch {
    return {
      title: "俱乐部等级说明",
      intro: "了解妙脆角俱乐部陪玩等级、价格区间、升级与权益。",
      updatedAt: "",
    };
  }
}

export async function saveClubLevelGuide(patch = {}, adminId = "admin") {
  const data = {
    title: String(patch.title || "俱乐部等级说明").trim() || "俱乐部等级说明",
    intro: String(patch.intro || patch.description || "").trim(),
  };
  const row = {
    id: "pc-club-level-guide",
    type: "club_level_guide",
    slug: "default",
    title: data.title,
    status: "published",
    enabled: true,
    sort: 1,
    draft: data,
    published: data,
    version: 1,
    published_by: adminId,
    published_at: nowIso(),
    updated_by: adminId,
    updated_at: nowIso(),
  };
  try {
    const existing = await sb(
      rest("platform_content_items", `?type=eq.club_level_guide&slug=eq.default&limit=1`)
    );
    if (Array.isArray(existing) && existing[0]?.id) {
      const patched = await sb(rest("platform_content_items", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        body: JSON.stringify({
          title: row.title,
          status: "published",
          enabled: true,
          draft: data,
          published: data,
          updated_by: adminId,
          updated_at: nowIso(),
          published_at: nowIso(),
        }),
      });
      return { guide: data, item: Array.isArray(patched) ? patched[0] : patched };
    }
    const created = await sb(rest("platform_content_items"), { method: "POST", body: JSON.stringify(row) });
    return { guide: data, item: Array.isArray(created) ? created[0] : created };
  } catch (err) {
    throw err;
  }
}
