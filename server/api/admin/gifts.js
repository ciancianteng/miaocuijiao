import { companionDb, isMissingRelation, decodeDataUrl } from "../_companion-media-store.js";
import { writeAdminLog } from "../_wallet.js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CONTENT_TYPE = "gift";
const SETTINGS_SLUG = "gift-settings";
const TX_TYPE = "gift_tx";
const GIFT_BUCKET = "gifts";
const MIGRATION_FILE = "supabase/migrations/20260807_gifts_catalog.sql";

function json(res, status, data) {
  return res.status(status).json(data);
}
function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || "").trim() || "admin";
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function nowIso() {
  return new Date().toISOString();
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

let giftsTableReady = null;

async function probeGiftsTable() {
  try {
    await companionDb("gifts", "?select=id&limit=1");
    giftsTableReady = true;
    return true;
  } catch (e) {
    if (isMissingRelation(e)) {
      giftsTableReady = false;
      return false;
    }
    throw e;
  }
}

async function tryApplyGiftsMigration() {
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DIRECT_URL ||
    "";
  if (!dbUrl) return { applied: false, reason: "no_database_url" };
  const sqlPath = resolve(process.cwd(), MIGRATION_FILE);
  if (!existsSync(sqlPath)) return { applied: false, reason: "migration_missing" };
  const pg = await import("pg");
  const Client = pg.default?.Client || pg.Client;
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(readFileSync(sqlPath, "utf8"));
  } finally {
    await client.end();
  }
  giftsTableReady = null;
  const ready = await probeGiftsTable();
  return { applied: true, tableReady: ready };
}

function mapGiftRow(g) {
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    iconUrl: g.icon_url || "",
    catFoodPrice: money(g.cat_food_price),
    enabled: !!g.enabled,
    featured: !!g.featured,
    sortOrder: g.sort_order ?? 100,
    animationLevel: g.animation_level || "normal",
    commissionRate: g.commission_rate == null || g.commission_rate === "" ? null : money(g.commission_rate),
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    source: "gifts",
  };
}

function mapContentGift(row) {
  if (!row) return null;
  const draft = row.draft && typeof row.draft === "object" ? row.draft : {};
  const published = row.published && typeof row.published === "object" ? row.published : {};
  const data = { ...draft, ...published };
  const enabled = row.enabled !== false && row.status !== "disabled" && data.enabled !== false;
  return {
    id: row.id,
    name: String(row.title || data.name || "").trim(),
    iconUrl: String(data.iconUrl || data.icon_url || "").trim(),
    catFoodPrice: money(data.catFoodPrice ?? data.cat_food_price),
    enabled,
    featured: data.featured === true || data.featured === "true",
    sortOrder: Number(row.sort ?? data.sortOrder ?? 100) || 100,
    animationLevel: String(data.animationLevel || "normal"),
    commissionRate:
      data.commissionRate == null || data.commissionRate === ""
        ? null
        : money(data.commissionRate),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source: "platform_content_items",
  };
}

async function listFromGiftsTable() {
  const rows = await companionDb("gifts", "?order=sort_order.asc&limit=200");
  return (rows || []).filter((g) => !g.deleted_at).map(mapGiftRow).filter(Boolean);
}

async function listFromContent() {
  const rows = await companionDb(
    "platform_content_items",
    `?type=eq.${encodeURIComponent(CONTENT_TYPE)}&order=sort.asc&limit=200`
  );
  return (rows || [])
    .filter((row) => row.status !== "unpublished")
    .map(mapContentGift)
    .filter((g) => g && g.name);
}

async function listGifts() {
  if (giftsTableReady !== false) {
    try {
      const list = await listFromGiftsTable();
      giftsTableReady = true;
      return { gifts: list, storage: "gifts" };
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      giftsTableReady = false;
    }
  }
  const list = await listFromContent();
  return { gifts: list, storage: "platform_content_items" };
}

async function ensurePublicGiftBucket() {
  const listRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const listText = await listRes.text();
  let list = [];
  try {
    list = listText ? JSON.parse(listText) : [];
  } catch {
    list = [];
  }
  if (!listRes.ok) throw new Error(`读取 Storage 失败：${listText || listRes.status}`);
  const exists = Array.isArray(list) && list.some((b) => b && (b.id === GIFT_BUCKET || b.name === GIFT_BUCKET));
  if (!exists) {
    const createRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: GIFT_BUCKET,
        name: GIFT_BUCKET,
        public: true,
        file_size_limit: 5 * 1024 * 1024,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      }),
    });
    const createText = await createRes.text();
    if (!createRes.ok && !/already exists|duplicate/i.test(createText)) {
      throw new Error(`创建礼物图片桶失败：${createText || createRes.status}`);
    }
  }
  return GIFT_BUCKET;
}

async function uploadGiftImage(dataUrl, filename = "gift") {
  const file = decodeDataUrl(dataUrl);
  if (!file) throw new Error("图片数据无效，请重新上传。");
  if (!/^image\/(jpeg|png|webp)$/i.test(file.contentType)) {
    throw new Error("仅支持 JPG / PNG / WEBP");
  }
  const bucket = await ensurePublicGiftBucket();
  const ext = (file.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
  const safeName = String(filename || "gift").replace(/[^a-z0-9.-]/gi, "-") || "gift";
  const objectPath = `icons/${Date.now()}-${safeName}.${ext}`;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": file.contentType,
        "x-upsert": "true",
      },
      body: file.buffer,
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`礼物图片上传失败：${text || response.status}`);
  }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function giftPayloadFromBody(body) {
  const name = String(body.name || "").trim();
  const catFoodPrice = money(body.catFoodPrice ?? body.cat_food_price);
  const commissionRaw = body.commissionRate ?? body.commission_rate;
  const commissionRate =
    commissionRaw === "" || commissionRaw == null ? null : money(commissionRaw);
  return {
    name,
    icon_url: String(body.iconUrl || body.icon_url || "").trim(),
    cat_food_price: catFoodPrice,
    enabled: body.enabled !== false && body.enabled !== "false" && body.enabled !== 0,
    featured: body.featured === true || body.featured === "true" || body.featured === 1,
    sort_order: Number(body.sortOrder ?? body.sort_order ?? 100) || 100,
    animation_level: String(body.animationLevel || "normal"),
    commission_rate: commissionRate,
    updated_at: nowIso(),
  };
}

async function saveGiftNative(id, payload) {
  const row = { ...payload };
  if (row.commission_rate == null) delete row.commission_rate;
  if (id) {
    const rows = await companionDb("gifts", `?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    return mapGiftRow(rows?.[0] || { ...row, id });
  }
  const rows = await companionDb("gifts", "", {
    method: "POST",
    body: JSON.stringify({ ...row, created_at: nowIso() }),
  });
  return mapGiftRow(rows?.[0]);
}

async function saveGiftContent(id, payload) {
  const giftId = id || `gift_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const draft = {
    name: payload.name,
    iconUrl: payload.icon_url,
    cat_food_price: payload.cat_food_price,
    catFoodPrice: payload.cat_food_price,
    featured: payload.featured,
    enabled: payload.enabled,
    sortOrder: payload.sort_order,
    animationLevel: payload.animation_level,
    commissionRate: payload.commission_rate,
  };
  const row = {
    id: giftId,
    type: CONTENT_TYPE,
    slug: giftId,
    title: payload.name,
    status: payload.enabled ? "published" : "disabled",
    enabled: !!payload.enabled,
    sort: payload.sort_order,
    draft,
    published: draft,
    version: 1,
    updated_at: nowIso(),
    published_at: payload.enabled ? nowIso() : null,
  };
  if (id) {
    const rows = await companionDb("platform_content_items", `?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    return mapContentGift(rows?.[0] || row);
  }
  row.created_at = nowIso();
  const rows = await companionDb("platform_content_items", "", {
    method: "POST",
    body: JSON.stringify(row),
  });
  return mapContentGift(rows?.[0] || row);
}

async function softDeleteGift(id) {
  if (giftsTableReady !== false) {
    try {
      await companionDb("gifts", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ deleted_at: nowIso(), enabled: false, updated_at: nowIso() }),
      });
      return;
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      giftsTableReady = false;
    }
  }
  await companionDb("platform_content_items", `?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      enabled: false,
      status: "disabled",
      updated_at: nowIso(),
    }),
  });
  // Also mark draft/published enabled=false so boss filters stay consistent.
  try {
    const rows = await companionDb("platform_content_items", `?id=eq.${encodeURIComponent(id)}&limit=1`);
    const row = rows?.[0];
    if (row) {
      const draft = { ...(row.draft || {}), enabled: false };
      const published = { ...(row.published || row.draft || {}), enabled: false };
      await companionDb("platform_content_items", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ draft, published, updated_at: nowIso() }),
      });
    }
  } catch {
    /* optional */
  }
}

async function loadCommissionRate() {
  try {
    const rows = await companionDb("gift_settings", "?id=eq.1&limit=1");
    if (rows?.[0]) return money(rows[0].commission_rate ?? 20);
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  try {
    const rows = await companionDb(
      "platform_content_items",
      `?type=eq.gift_settings&slug=eq.${encodeURIComponent(SETTINGS_SLUG)}&limit=1`
    );
    const draft = rows?.[0]?.draft || {};
    return money(draft.commissionRate ?? draft.commission_rate ?? 20);
  } catch {
    return 20;
  }
}

async function saveCommissionRate(rate) {
  try {
    await companionDb("gift_settings", "?on_conflict=id", {
      method: "POST",
      body: JSON.stringify({ id: 1, commission_rate: rate, updated_at: nowIso() }),
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    return;
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  const row = {
    id: "gift_settings_global",
    type: "gift_settings",
    slug: SETTINGS_SLUG,
    title: "礼物抽成",
    status: "published",
    enabled: true,
    sort: 0,
    draft: { commissionRate: rate },
    published: { commissionRate: rate },
    updated_at: nowIso(),
    published_at: nowIso(),
  };
  const existing = await companionDb(
    "platform_content_items",
    `?type=eq.gift_settings&slug=eq.${encodeURIComponent(SETTINGS_SLUG)}&limit=1`
  ).catch(() => []);
  if (existing?.[0]?.id) {
    await companionDb("platform_content_items", `?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
  } else {
    row.created_at = nowIso();
    await companionDb("platform_content_items", "", { method: "POST", body: JSON.stringify(row) });
  }
}

async function listTransactions(limit = 100) {
  try {
    const rows = await companionDb("gift_transactions", `?order=created_at.desc&limit=${limit}`);
    return (rows || []).map((t) => ({
      id: t.id,
      txNo: t.tx_no,
      giftName: t.gift_name,
      giftId: t.gift_id,
      quantity: t.quantity,
      grossCatFood: money(t.gross_cat_food),
      commissionRate: money(t.platform_commission_rate),
      commissionAmount: money(t.platform_commission_amount),
      companionIncome: money(t.companion_income),
      bossId: t.sender_boss_id,
      companionId: t.receiver_companion_id,
      kind: t.kind,
      createdAt: t.created_at,
      source: "gift_transactions",
    }));
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  const rows = await companionDb(
    "platform_content_items",
    `?type=eq.${encodeURIComponent(TX_TYPE)}&order=created_at.desc&limit=${limit}`
  ).catch(() => []);
  return (rows || []).map((row) => {
    const d = row.draft || {};
    return {
      id: row.id,
      txNo: d.txNo || row.slug,
      giftName: d.giftName || row.title,
      giftId: d.giftId || "",
      quantity: d.quantity || 1,
      grossCatFood: money(d.grossCatFood),
      commissionRate: money(d.commissionRate),
      commissionAmount: money(d.commissionAmount),
      companionIncome: money(d.companionIncome),
      bossId: d.bossId || "",
      companionId: d.companionId || "",
      kind: d.kind || "gift",
      createdAt: row.created_at,
      source: "platform_content_items",
    };
  });
}

export default async function handler(req, res) {
  try {
    await (await import("../_admin-auth.js")).requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (String(q.action || "") === "transactions") {
        const transactions = await listTransactions(200);
        return json(res, 200, { ok: true, transactions });
      }
      // Best-effort schema ensure (no developer SQL prompt to admins).
      if (giftsTableReady === null) {
        const ready = await probeGiftsTable();
        if (!ready) {
          await tryApplyGiftsMigration().catch(() => null);
        }
      }
      const { gifts, storage } = await listGifts();
      const commissionRate = await loadCommissionRate();
      return json(res, 200, {
        ok: true,
        gifts,
        commissionRate,
        storage,
        message: "",
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "ensure_schema") {
      const applied = await tryApplyGiftsMigration();
      const { gifts, storage } = await listGifts();
      return json(res, 200, {
        ok: true,
        ...applied,
        storage,
        giftCount: gifts.length,
        message: applied.tableReady
          ? "礼物表已就绪"
          : storage === "platform_content_items"
            ? "礼物数据已接通（内容表持久化），可正常新增/编辑"
            : "礼物存储已就绪",
      });
    }

    if (action === "upload_icon") {
      const dataUrl = String(body.imageDataUrl || body.iconDataUrl || body.dataUrl || "").trim();
      if (!dataUrl) return json(res, 400, { ok: false, message: "请先选择礼物图片" });
      const iconUrl = await uploadGiftImage(dataUrl, body.filename || "gift-icon");
      return json(res, 200, { ok: true, iconUrl, message: "图片已上传" });
    }

    if (action === "save") {
      const id = String(body.id || "").trim();
      const payload = giftPayloadFromBody(body);
      if (!payload.name || payload.cat_food_price <= 0) {
        return json(res, 400, { ok: false, message: "请填写礼物名称和有效猫粮价格" });
      }
      let gift = null;
      let storage = "gifts";
      if (giftsTableReady !== false) {
        try {
          gift = await saveGiftNative(id, payload);
          giftsTableReady = true;
        } catch (e) {
          if (!isMissingRelation(e)) throw e;
          giftsTableReady = false;
        }
      }
      if (!gift) {
        gift = await saveGiftContent(id, payload);
        storage = "platform_content_items";
      }
      await writeAdminLog({
        module: "gifts",
        action: id ? "update_gift" : "create_gift",
        targetType: "gift",
        targetId: gift?.id || id,
        operatorRole: roleFrom(req),
      });
      return json(res, 200, { ok: true, message: "礼物已保存", gift, storage });
    }

    if (action === "soft_delete" || action === "disable") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少礼物 ID" });
      await softDeleteGift(id);
      await writeAdminLog({
        module: "gifts",
        action: "disable_gift",
        targetType: "gift",
        targetId: id,
        operatorRole: roleFrom(req),
      });
      return json(res, 200, { ok: true, message: "礼物已停用/下架" });
    }

    if (action === "save_commission") {
      const rate = money(body.commissionRate ?? body.rate ?? 20);
      if (rate < 0 || rate > 100) {
        return json(res, 400, { ok: false, message: "抽成比例需在 0–100 之间" });
      }
      await saveCommissionRate(rate);
      return json(res, 200, { ok: true, message: "默认礼物抽成已更新", rate });
    }

    if (action === "list_transactions") {
      const transactions = await listTransactions(200);
      return json(res, 200, { ok: true, transactions });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, {
      ok: false,
      message: error.message || "礼物管理异常",
    });
  }
}

/** Shared helpers for boss marketplace when gifts table is absent. */
export async function listEnabledGiftsForBoss() {
  const { gifts } = await listGifts();
  return (gifts || []).filter((g) => g.enabled);
}

export async function loadGiftCommissionRate(companionRow) {
  const fromCompanion = money(companionRow?.gift_commission_rate);
  if (fromCompanion > 0) return fromCompanion;
  return loadCommissionRate();
}
