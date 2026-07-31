/**
 * Idempotent P0-3 Preview fixtures.
 * Uses tables known to exist on Preview: profiles, companion_profiles, banners, announcements.
 * TEST-marked; removable before production.
 */
import "../_load-env.js";

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const COMPANION_EMAIL = "companion@meow.test";
const TEST_NICK = "[TEST] 验收陪玩";
const TEAM_TITLE = "[TEST] 手游组队频道";
const PRODUCT_TITLE = "[TEST] 护航验收商品";
const GP_MARKER = "[MCJ_GP]";

function json(res, status, data) {
  res.status(status).json(data);
}
function hasDb() {
  return REQUIRED.every((k) => process.env[k]);
}
function headers(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function auth(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
async function sb(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(body?.message || body?.msg || body?.error_description || body?.hint || `请求失败 ${response.status}`);
  }
  return body;
}
function isMissing(err) {
  return /Could not find the table|schema cache|PGRST205|does not exist|column .* does not exist/i.test(String(err?.message || err || ""));
}

async function ensureCompanion() {
  let profileRows = await sb(rest("profiles", `?email=eq.${encodeURIComponent(COMPANION_EMAIL)}&limit=1`), { headers: headers() });
  let profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (!profile) {
    const listed = await sb(`${auth("admin/users")}?page=1&per_page=200`, { headers: headers() }).catch(() => null);
    const authUser = (listed?.users || []).find((u) => String(u.email || "").toLowerCase() === COMPANION_EMAIL);
    if (!authUser) throw new Error(`未找到 ${COMPANION_EMAIL}，请先按 README_DEPLOY 创建陪玩测试账号。`);
    const upserted = await sb(rest("profiles"), {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        id: authUser.id,
        role: "companion",
        display_name: TEST_NICK,
        email: COMPANION_EMAIL,
        avatar_url: "/default-avatar.png",
        status: "active",
      }),
    });
    profile = Array.isArray(upserted) ? upserted[0] : { id: authUser.id };
  } else {
    await sb(rest("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        role: "companion",
        display_name: TEST_NICK,
        avatar_url: profile.avatar_url || "/default-avatar.png",
        status: "active",
      }),
    });
  }

  const base = {
    user_id: profile.id,
    nickname: TEST_NICK,
    game: "VALORANT",
    level_name: "Lv.2 灵喵",
    price: 35,
    commission_rate: 20,
    deposit_status: "paid",
    verification_status: "approved",
    online_status: "online",
    description: "P0-3 Preview 验收专用测试陪玩（正式上线前可删除）。TEST",
    card_image_url: "/default-avatar.png",
  };
  const existing = await sb(rest("companion_profiles", `?user_id=eq.${encodeURIComponent(profile.id)}&limit=1`), { headers: headers() });
  if (Array.isArray(existing) && existing[0]) {
    try {
      await sb(rest("companion_profiles", `?user_id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ ...base, availability_status: "online", tags: "TEST,验收,可接单", pricing_unit: "小时" }),
      });
    } catch (e) {
      if (!isMissing(e)) throw e;
      await sb(rest("companion_profiles", `?user_id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(base),
      });
    }
  } else {
    try {
      await sb(rest("companion_profiles"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ ...base, availability_status: "online", tags: "TEST,验收,可接单", pricing_unit: "小时" }),
      });
    } catch (e) {
      if (!isMissing(e)) throw e;
      await sb(rest("companion_profiles"), { method: "POST", headers: headers(), body: JSON.stringify(base) });
    }
  }
  return { profileId: profile.id, nickname: TEST_NICK };
}

async function ensureTeamChannel() {
  // Prefer platform_content_items
  try {
    const draft = {
      image: "/default-avatar.png",
      name: TEAM_TITLE,
      description: "P0-3 Preview 验收测试频道（正式上线前可删除）。",
      discordUrl: "https://discord.gg/discord-developers",
      sort: 1,
      enabled: true,
    };
    const existing = await sb(
      rest("platform_content_items", `?type=eq.team_lobby_channels&slug=eq.p03-test-team-channel&limit=1`),
      { headers: headers() }
    );
    if (Array.isArray(existing) && existing[0]) {
      await sb(rest("platform_content_items", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ title: TEAM_TITLE, status: "published", enabled: true, sort: 1, draft, published: draft }),
      });
      return { source: "platform_content_items" };
    }
    await sb(rest("platform_content_items"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        type: "team_lobby_channels",
        slug: "p03-test-team-channel",
        title: TEAM_TITLE,
        status: "published",
        enabled: true,
        sort: 1,
        draft,
        published: draft,
      }),
    });
    return { source: "platform_content_items" };
  } catch (e) {
    if (!isMissing(e)) throw e;
  }

  // Fallback: banners table (exists in init.sql)
  const existing = await sb(rest("banners", `?title=eq.${encodeURIComponent(TEAM_TITLE)}&limit=1`), { headers: headers() });
  const payload = {
    title: TEAM_TITLE,
    subtitle: "P0-3 Preview 验收测试频道（正式上线前可删除）。|__team_lobby__",
    image_url: "/default-avatar.png",
    button_text: "立即进入",
    button_link: "https://discord.gg/discord-developers",
    is_active: true,
    sort_order: 1,
    updated_at: new Date().toISOString(),
  };
  if (Array.isArray(existing) && existing[0]) {
    await sb(rest("banners", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(payload),
    });
  } else {
    await sb(rest("banners"), { method: "POST", headers: headers(), body: JSON.stringify(payload) });
  }
  return { source: "banners" };
}

async function ensureGameplayProduct() {
  try {
    const payload = {
      name: PRODUCT_TITLE,
      category: "护航",
      game_ids: ["VALORANT"],
      games_text: "VALORANT",
      cover_url: "/default-avatar.png",
      short_description: "P0-3 Preview 验收测试玩法商品（正式上线前可删除）。",
      description: "TEST 商品",
      price: 49,
      pricing_unit: "每单",
      fixed_price: true,
      status: "published",
      featured: true,
      sold_count: 0,
      sort_order: 1,
      dispatch_to_cs: true,
      updated_at: new Date().toISOString(),
    };
    const existing = await sb(rest("gameplay_products", `?name=eq.${encodeURIComponent(PRODUCT_TITLE)}&limit=1`), {
      headers: headers(),
    });
    if (Array.isArray(existing) && existing[0]) {
      await sb(rest("gameplay_products", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(payload),
      });
    } else {
      await sb(rest("gameplay_products"), { method: "POST", headers: headers(), body: JSON.stringify(payload) });
    }
    return { source: "gameplay_products" };
  } catch (e) {
    if (!isMissing(e)) throw e;
  }

  // Fallback: announcements encode TEST gameplay product
  const title = `${GP_MARKER}${PRODUCT_TITLE}`;
  const content = JSON.stringify({
    id: "p03-test-gameplay",
    name: PRODUCT_TITLE,
    category: "护航",
    gameIds: ["VALORANT"],
    gamesText: "VALORANT",
    coverUrl: "/default-avatar.png",
    shortDescription: "P0-3 Preview 验收测试玩法商品（正式上线前可删除）。",
    description: "TEST 商品",
    price: 49,
    pricingUnit: "每单",
    fixedPrice: true,
    status: "published",
    featured: true,
    soldCount: 0,
    sortOrder: 1,
    dispatchToCs: true,
  });
  const existing = await sb(rest("announcements", `?title=eq.${encodeURIComponent(title)}&limit=1`), { headers: headers() });
  const row = {
    title,
    content,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  try {
    row.published_at = new Date().toISOString();
  } catch (_) {}
  if (Array.isArray(existing) && existing[0]) {
    try {
      await sb(rest("announcements", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(row),
      });
    } catch (e) {
      if (!isMissing(e)) throw e;
      await sb(rest("announcements", `?id=eq.${encodeURIComponent(existing[0].id)}`), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ title, content, is_active: true }),
      });
    }
  } else {
    try {
      await sb(rest("announcements"), { method: "POST", headers: headers(), body: JSON.stringify(row) });
    } catch (e) {
      if (!isMissing(e)) throw e;
      await sb(rest("announcements"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ title, content, is_active: true }),
      });
    }
  }
  return { source: "announcements" };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) return json(res, 503, { ok: false, message: "未配置 Supabase" });
  try {
    const companion = await ensureCompanion();
    const team = await ensureTeamChannel();
    const gameplay = await ensureGameplayProduct();
    return json(res, 200, {
      ok: true,
      message: "P0-3 Preview 测试数据已就绪（TEST 标记，上线前可删）。",
      companion,
      team,
      gameplay,
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "seed failed" });
  }
}
