const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const BANNER_BUCKET = () => String(process.env.SUPABASE_CONTENT_BUCKET || process.env.SUPABASE_BANNER_BUCKET || "banners").trim() || "banners";

function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function storageObjectUrl(bucket, objectPath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
}
function publicStorageUrl(bucket, objectPath) {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
function supabaseError(body, response) {
  const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
  return body;
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
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问 Banner 管理。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}
function isMissingMainColumn(error) {
  const msg = String(error?.message || error || "");
  return /is_main/i.test(msg) && /(column|schema|does not exist|PGRST204|42703)/i.test(msg);
}
function isMissingCropColumn(error) {
  const msg = String(error?.message || error || "");
  return /crop_meta/i.test(msg) && /(column|schema|does not exist|PGRST204|42703)/i.test(msg);
}
function isMissingMobileColumn(error) {
  const msg = String(error?.message || error || "");
  return /mobile_image_url|mobile_crop_meta/i.test(msg) && /(column|schema|does not exist|PGRST204|42703)/i.test(msg);
}
const DESKTOP_RATIO = { w: 1920, h: 700 };
const MOBILE_RATIO = { w: 1080, h: 1350 };
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function normalizeCropMeta(raw, ratioDefaults = DESKTOP_RATIO) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const ratioW = clampNum(src.ratioW ?? src.ratio_w ?? ratioDefaults.w, 320, 4096, ratioDefaults.w);
  const ratioH = clampNum(src.ratioH ?? src.ratio_h ?? ratioDefaults.h, 120, 2160, ratioDefaults.h);
  let zoom = clampNum(src.zoom ?? src.scale ?? 1, 1, 4, 1);
  let x = Number(src.x ?? src.offsetX ?? src.nx ?? 0);
  let y = Number(src.y ?? src.offsetY ?? src.ny ?? 0);
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(y)) y = 0;
  // Legacy admin pixel pans (±400) → frame fractions
  if (Math.abs(x) > 2 || Math.abs(y) > 2) {
    x = clampNum(x / 640, -1.5, 1.5, 0);
    y = clampNum(y / 360, -1.5, 1.5, 0);
  } else {
    x = clampNum(x, -1.5, 1.5, 0);
    y = clampNum(y, -1.5, 1.5, 0);
  }
  return {
    zoom,
    scale: zoom,
    x,
    y,
    offsetX: x,
    offsetY: y,
    ratioW,
    ratioH,
    ratio: `${Math.round(ratioW)}:${Math.round(ratioH)}`,
  };
}
function cropFromBody(body, fallback = null, ratioDefaults = DESKTOP_RATIO) {
  if (body.crop_meta !== undefined || body.cropMeta !== undefined || body.crop !== undefined) {
    return normalizeCropMeta(body.crop_meta ?? body.cropMeta ?? body.crop, ratioDefaults);
  }
  return fallback ? normalizeCropMeta(fallback, ratioDefaults) : normalizeCropMeta({}, ratioDefaults);
}
function mobileCropFromBody(body, fallback = null) {
  if (
    body.mobile_crop_meta !== undefined ||
    body.mobileCropMeta !== undefined ||
    body.mobile_crop !== undefined ||
    body.mobileCrop !== undefined
  ) {
    return normalizeCropMeta(
      body.mobile_crop_meta ?? body.mobileCropMeta ?? body.mobile_crop ?? body.mobileCrop,
      MOBILE_RATIO
    );
  }
  return fallback ? normalizeCropMeta(fallback, MOBILE_RATIO) : normalizeCropMeta({}, MOBILE_RATIO);
}
function stripMobileFields(payload) {
  const next = { ...payload };
  delete next.mobile_image_url;
  delete next.mobile_crop_meta;
  return next;
}
function omitKeys(payload, keys) {
  const next = { ...payload };
  for (const key of keys) delete next[key];
  return next;
}
async function writeBannerRow(method, url, payload) {
  const attempts = [
    payload,
    omitKeys(payload, ["crop_meta"]),
    stripMobileFields(payload),
    omitKeys(payload, ["crop_meta", "mobile_image_url", "mobile_crop_meta"]),
    omitKeys(payload, ["is_main"]),
    omitKeys(payload, ["is_main", "crop_meta", "mobile_image_url", "mobile_crop_meta"]),
  ];
  let lastError = null;
  const seen = new Set();
  for (const attempt of attempts) {
    const key = JSON.stringify(Object.keys(attempt).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      return await supabaseJson(url, {
        method,
        headers: serviceHeaders(),
        body: JSON.stringify(attempt),
      });
    } catch (error) {
      lastError = error;
      if (!isMissingCropColumn(error) && !isMissingMobileColumn(error) && !isMissingMainColumn(error)) {
        throw error;
      }
    }
  }
  throw lastError || new Error("Banner 写入失败");
}
function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}
function sortOrderOf(value, fallback = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(9999, Math.round(n))) : fallback;
}
function normalizeBannerLink(link) {
  const s = String(link || "").trim();
  if (!s) return "";
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(s)) return s;
  if (/^(discord\.gg|discord\.com|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|www\.)/i.test(s)) {
    return `https://${s}`;
  }
  return s;
}
async function ensureBannerBucket() {
  const bucket = BANNER_BUCKET();
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
  if (!listRes.ok) {
    throw new Error(`读取 Storage 桶失败：${listText || listRes.status}`);
  }
  const exists = Array.isArray(list) && list.some((item) => item && (item.id === bucket || item.name === bucket));
  if (exists) return bucket;

  const createRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: 10485760,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    }),
  });
  const createText = await createRes.text();
  if (!createRes.ok && !/already exists|duplicate/i.test(createText)) {
    throw new Error(`创建 Storage 桶失败：${createText || createRes.status}`);
  }
  return bucket;
}
async function uploadBannerImage(dataUrl, filename = "banner") {
  const file = decodeDataUrl(dataUrl);
  if (!file) throw new Error("图片数据无效，请重新上传。");
  const bucket = await ensureBannerBucket();
  const ext = (file.contentType.split("/")[1] || "png").replace("jpeg", "jpg");
  const rawName = String(filename || "homepage-banner");
  const baseName = rawName.replace(/\.[a-z0-9]+$/i, "");
  const safeName = baseName.replace(/[^a-z0-9.-]/gi, "-") || "homepage-banner";
  const objectPath = `homepage/${Date.now()}-${safeName}.${ext}`;
  const response = await fetch(storageObjectUrl(bucket, objectPath), {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": file.contentType,
      "x-upsert": "true",
    },
    body: file.buffer,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Banner 图片上传失败：${text || response.status}`);
  }
  return publicStorageUrl(bucket, objectPath);
}
function mapBanner(row) {
  if (!row) return null;
  const crop = normalizeCropMeta(row.crop_meta || row.crop || {}, DESKTOP_RATIO);
  const mobileCrop = normalizeCropMeta(row.mobile_crop_meta || row.mobile_crop || {}, MOBILE_RATIO);
  const mobileUrl = String(row.mobile_image_url || "").trim();
  return {
    id: row.id,
    title: row.title || "",
    subtitle: row.subtitle || "",
    image_url: row.image_url || "",
    desktop_image_url: row.image_url || "",
    mobile_image_url: mobileUrl,
    button_text: row.button_text || "",
    button_link: row.button_link || "",
    is_active: row.is_active === true,
    sort_order: row.sort_order == null ? 100 : Number(row.sort_order),
    is_main: row.is_main === true,
    crop_meta: crop,
    crop,
    mobile_crop_meta: mobileCrop,
    mobile_crop: mobileCrop,
    has_dedicated_mobile: !!mobileUrl,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function sortBanners(list) {
  // Formal rule: smaller sort_order first. Never let is_main override carousel order.
  // Stable tie-break: created_at ASC, then id ASC.
  return list.slice().sort((a, b) => {
    const sortDiff = Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100);
    if (sortDiff) return sortDiff;
    const createdDiff = String(a.created_at || "").localeCompare(String(b.created_at || ""));
    if (createdDiff) return createdDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}
async function listBanners() {
  let rows;
  try {
    rows = await supabaseJson(
      restUrl("banners", "?order=sort_order.asc.nullslast,created_at.asc.nullslast,id.asc&limit=200"),
      { headers: serviceHeaders() }
    );
  } catch (error) {
    rows = await supabaseJson(restUrl("banners", "?order=sort_order.asc.nullslast,updated_at.asc&limit=200"), {
      headers: serviceHeaders(),
    });
  }
  const banners = sortBanners((Array.isArray(rows) ? rows : []).map(mapBanner).filter(Boolean));
  const current = banners.find((b) => b.is_main && b.is_active) || banners.find((b) => b.is_active) || banners[0] || null;
  return { banners, current, history: banners };
}
async function clearOtherMain(exceptId) {
  try {
    const query = exceptId
      ? `?is_main=eq.true&id=neq.${encodeURIComponent(exceptId)}`
      : "?is_main=eq.true";
    await supabaseJson(restUrl("banners", query), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ is_main: false, updated_at: new Date().toISOString() }),
    });
  } catch (error) {
    if (!isMissingMainColumn(error)) throw error;
  }
}
async function patchBanner(id, patch) {
  const rows = await writeBannerRow("PATCH", restUrl("banners", `?id=eq.${encodeURIComponent(id)}`), {
    ...patch,
    updated_at: new Date().toISOString(),
  });
  return (Array.isArray(rows) ? rows[0] : null) || null;
}
async function setMainBanner(id, { ensureActive = false } = {}) {
  await clearOtherMain(id);
  const patch = { is_main: true };
  if (ensureActive) patch.is_active = true;
  try {
    return await patchBanner(id, patch);
  } catch (error) {
    if (!isMissingMainColumn(error)) throw error;
    if (ensureActive) return await patchBanner(id, { is_active: true });
    const rows = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
      headers: serviceHeaders(),
    });
    return rows[0] || null;
  }
}
async function promoteMainIfNeeded() {
  const data = await listBanners();
  if (data.banners.some((b) => b.is_main)) return data;
  const next = data.banners.find((b) => b.is_active) || data.banners[0];
  if (!next) return data;
  try {
    await setMainBanner(next.id, { ensureActive: false });
  } catch (error) {
    if (!isMissingMainColumn(error)) throw error;
  }
  return listBanners();
}
function buildMetaFromBody(body, { defaults = {} } = {}) {
  const title = body.title !== undefined ? String(body.title || "").trim() : defaults.title;
  const subtitle = body.subtitle !== undefined ? String(body.subtitle || "").trim() : defaults.subtitle;
  const button_text =
    body.button_text !== undefined || body.buttonText !== undefined
      ? String(body.button_text || body.buttonText || "").trim()
      : defaults.button_text;
  const button_link = normalizeBannerLink(
    body.button_link !== undefined || body.buttonLink !== undefined || body.link !== undefined
      ? String(body.button_link || body.buttonLink || body.link || "").trim()
      : defaults.button_link
  );
  const is_active =
    body.is_active !== undefined || body.isActive !== undefined
      ? truthy(body.is_active ?? body.isActive, true)
      : defaults.is_active;
  const sort_order =
    body.sort_order !== undefined || body.sortOrder !== undefined || body.sort !== undefined
      ? sortOrderOf(body.sort_order ?? body.sortOrder ?? body.sort, 100)
      : defaults.sort_order;
  const is_main =
    body.is_main !== undefined || body.isMain !== undefined
      ? truthy(body.is_main ?? body.isMain, false)
      : defaults.is_main;
  const crop_meta = cropFromBody(body, defaults.crop_meta || defaults.crop || null, DESKTOP_RATIO);
  const mobile_crop_meta = mobileCropFromBody(body, defaults.mobile_crop_meta || defaults.mobile_crop || null);
  return { title, subtitle, button_text, button_link, is_active, sort_order, is_main, crop_meta, mobile_crop_meta };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      current: null,
      banners: [],
      history: [],
      message: "未配置 Supabase，Banner 管理不可用。",
    });
  }
  try {
    await requireAdmin(req);
    if (req.method === "GET") {
      const data = await listBanners();
      return json(res, 200, { ok: true, configured: true, ...data });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "");

    if (action === "upload") {
      const imageData = String(body.image_data || body.imageData || "");
      if (!imageData) return json(res, 400, { ok: false, message: "请先选择 Banner 图片。" });
      const imageUrl = await uploadBannerImage(imageData, body.filename || "homepage-banner");
      return json(res, 200, {
        ok: true,
        message: "图片上传成功",
        url: imageUrl,
        image_url: imageUrl,
      });
    }

    if (action === "publish") {
      const desktopData = String(body.image_data || body.imageData || body.desktop_image_data || body.desktopImageData || "");
      const existingUrl = String(body.image_url || body.imageUrl || body.desktop_image_url || body.desktopImageUrl || "").trim();
      let imageUrl = existingUrl;
      if (desktopData) {
        imageUrl = await uploadBannerImage(desktopData, body.filename || body.desktop_filename || "homepage-banner-desktop");
      }
      if (!imageUrl) return json(res, 400, { ok: false, message: "请先上传电脑端 Banner 图片。" });
      if (!/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("/")) {
        return json(res, 400, { ok: false, message: "电脑端图片地址无效，请重新上传。" });
      }

      const mobileData = String(body.mobile_image_data || body.mobileImageData || "");
      let mobileImageUrl = String(body.mobile_image_url || body.mobileImageUrl || "").trim();
      if (mobileData) {
        mobileImageUrl = await uploadBannerImage(mobileData, body.mobile_filename || "homepage-banner-mobile");
      }
      if (mobileImageUrl && !/^https?:\/\//i.test(mobileImageUrl) && !mobileImageUrl.startsWith("/")) {
        return json(res, 400, { ok: false, message: "手机端图片地址无效，请重新上传。" });
      }

      const now = new Date().toISOString();
      const meta = buildMetaFromBody(body, {
        defaults: {
          title: "",
          subtitle: "",
          button_text: "",
          button_link: "",
          is_active: true,
          sort_order: 100,
          is_main: false,
          crop_meta: normalizeCropMeta({}, DESKTOP_RATIO),
          mobile_crop_meta: normalizeCropMeta({}, MOBILE_RATIO),
        },
      });
      // Do NOT force is_main on publish — sort_order is the public carousel order.
      // is_main remains an optional "当前" pointer via set_current only.
      const payload = {
        title: meta.title,
        subtitle: meta.subtitle,
        image_url: imageUrl,
        mobile_image_url: mobileImageUrl || null,
        button_text: meta.button_text,
        button_link: meta.button_link,
        is_active: meta.is_active !== false,
        sort_order: meta.sort_order,
        crop_meta: meta.crop_meta,
        mobile_crop_meta: meta.mobile_crop_meta,
        is_main: meta.is_main === true,
        created_at: now,
        updated_at: now,
      };
      if (payload.is_main) await clearOtherMain(null);
      const rows = await writeBannerRow("POST", restUrl("banners"), payload);
      let banner = mapBanner(rows[0] || payload);
      try {
        if (payload.is_main) {
          const promoted = await setMainBanner(banner.id, { ensureActive: !!payload.is_active });
          if (promoted) banner = mapBanner(promoted);
        } else {
          await promoteMainIfNeeded();
        }
      } catch {
        /* best effort */
      }
      const data = await listBanners();
      return json(res, 200, {
        ok: true,
        message: mobileImageUrl
          ? "Banner 发布成功（已含手机端图）"
          : "Banner 发布成功。建议另传手机端竖图，否则手机将裁切电脑端横图。",
        banner,
        homepage_url: imageUrl,
        ...data,
      });
    }

    if (action === "update") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const existing = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      if (!existing[0]) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const mapped = mapBanner(existing[0]);
      const meta = buildMetaFromBody(body, {
        defaults: {
          title: mapped.title,
          subtitle: mapped.subtitle,
          button_text: mapped.button_text,
          button_link: mapped.button_link,
          is_active: mapped.is_active,
          sort_order: mapped.sort_order,
          is_main: mapped.is_main,
          crop_meta: mapped.crop_meta,
          mobile_crop_meta: mapped.mobile_crop_meta,
        },
      });
      const patch = {
        title: meta.title,
        subtitle: meta.subtitle,
        button_text: meta.button_text,
        button_link: meta.button_link,
        is_active: meta.is_active,
        sort_order: meta.sort_order,
        crop_meta: meta.crop_meta,
        mobile_crop_meta: meta.mobile_crop_meta,
        is_main: !!meta.is_main,
      };

      const desktopData = String(body.image_data || body.imageData || body.desktop_image_data || body.desktopImageData || "");
      const nextDesktopUrl = String(body.image_url || body.imageUrl || body.desktop_image_url || body.desktopImageUrl || "").trim();
      if (desktopData) {
        patch.image_url = await uploadBannerImage(desktopData, body.filename || body.desktop_filename || "homepage-banner-desktop");
      } else if (nextDesktopUrl) {
        if (!/^https?:\/\//i.test(nextDesktopUrl) && !nextDesktopUrl.startsWith("/")) {
          return json(res, 400, { ok: false, message: "电脑端图片地址无效，请重新上传。" });
        }
        patch.image_url = nextDesktopUrl;
      }

      const clearMobile =
        truthy(body.clear_mobile_image ?? body.clearMobileImage, false) ||
        body.mobile_image_url === "" ||
        body.mobileImageUrl === "";
      const mobileData = String(body.mobile_image_data || body.mobileImageData || "");
      const nextMobileUrl = String(body.mobile_image_url || body.mobileImageUrl || "").trim();
      if (clearMobile && !mobileData) {
        patch.mobile_image_url = null;
        patch.mobile_crop_meta = normalizeCropMeta({}, MOBILE_RATIO);
      } else if (mobileData) {
        patch.mobile_image_url = await uploadBannerImage(mobileData, body.mobile_filename || "homepage-banner-mobile");
      } else if (nextMobileUrl) {
        if (!/^https?:\/\//i.test(nextMobileUrl) && !nextMobileUrl.startsWith("/")) {
          return json(res, 400, { ok: false, message: "手机端图片地址无效，请重新上传。" });
        }
        patch.mobile_image_url = nextMobileUrl;
      }

      if (meta.is_main) await clearOtherMain(id);
      const row = await patchBanner(id, patch);
      let data = await listBanners();
      if (meta.is_active === false && (mapped.is_main || patch.is_main === false)) {
        data = await promoteMainIfNeeded();
      }
      const banner = mapBanner(row) || data.history.find((b) => String(b.id) === String(id)) || null;
      return json(res, 200, {
        ok: true,
        message: banner?.has_dedicated_mobile
          ? "Banner 已更新"
          : "Banner 已更新。未上传手机端图时，手机首页将自动裁切电脑端横图，建议补传竖图。",
        banner,
        ...data,
      });
    }

    if (action === "set_main") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const banner = await setMainBanner(id, { ensureActive: false });
      if (!banner) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const data = await listBanners();
      return json(res, 200, { ok: true, message: "已设为主 Banner", banner: mapBanner(banner), ...data });
    }

    if (action === "set_active" || action === "toggle_active") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const existing = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      if (!existing[0]) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const nextActive =
        body.is_active !== undefined || body.isActive !== undefined
          ? truthy(body.is_active ?? body.isActive, !existing[0].is_active)
          : !existing[0].is_active;
      const banner = await patchBanner(id, { is_active: nextActive });
      let data = await listBanners();
      if (!nextActive && existing[0].is_main === true) {
        data = await promoteMainIfNeeded();
      }
      return json(res, 200, {
        ok: true,
        message: nextActive ? "Banner 已启用" : "Banner 已关闭",
        banner: mapBanner(banner),
        ...data,
      });
    }

    if (action === "set_current") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const banner = await setMainBanner(id, { ensureActive: true });
      if (!banner) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const data = await listBanners();
      return json(res, 200, { ok: true, message: "Banner 发布成功", banner: mapBanner(banner), ...data });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { ok: false, message: "缺少 Banner ID。" });
      const existing = await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: serviceHeaders(),
      });
      if (!existing[0]) return json(res, 404, { ok: false, message: "Banner 不存在。" });
      const wasMain = existing[0].is_main === true;
      const urlsToMaybeDelete = ["image_url", "mobile_image_url"]
        .map((field) => String(existing[0][field] || "").trim())
        .filter(Boolean);
      // Check other rows BEFORE deleting, so shared Storage objects are kept.
      let others = [];
      try {
        others = await supabaseJson(
          restUrl("banners", "?select=id,image_url,mobile_image_url&limit=500"),
          { headers: serviceHeaders() }
        );
      } catch {
        others = [];
      }
      await supabaseJson(restUrl("banners", `?id=eq.${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
      for (const url of urlsToMaybeDelete) {
        const stillUsed = (Array.isArray(others) ? others : []).some(
          (row) =>
            String(row.id) !== String(id) &&
            (String(row.image_url || "") === url || String(row.mobile_image_url || "") === url)
        );
        if (stillUsed) continue;
        const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/i);
        if (!m) continue;
        try {
          await fetch(storageObjectUrl(m[1], decodeURIComponent(m[2])), {
            method: "DELETE",
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
          });
        } catch {
          /* ignore storage cleanup failures */
        }
      }
      let data = await listBanners();
      if (wasMain) data = await promoteMainIfNeeded();
      return json(res, 200, { ok: true, message: "Banner 已删除。", ...data });
    }

    return json(res, 400, { ok: false, message: "未知 Banner 操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "Banner 管理接口异常。" });
  }
}
