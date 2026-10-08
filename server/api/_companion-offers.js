/**
 * Companion-selected catalog offers.
 * Stored on the existing companion_profiles.service_standards map under a
 * reserved key so we do not add a second catalog or require new columns.
 */
import { companionDb } from "./_companion-media-store.js";
import { loadCompanionServiceStandards } from "./_service-standard.js";

const OFFER_KEY = "__catalogOffers";

function cleanOffers(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  return list
    .map((raw, index) => {
      const kind = raw?.kind === "product" ? "product" : "service";
      const id = String(raw?.id || "").trim();
      return {
        kind,
        id,
        enabled: raw?.enabled !== false && raw?.enabled !== "false",
        sort: Number.isFinite(Number(raw?.sort)) ? Number(raw.sort) : index,
      };
    })
    .filter((item) => item.id && !seen.has(`${item.kind}:${item.id}`) && seen.add(`${item.kind}:${item.id}`))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 40)
    .map((item, index) => ({ ...item, sort: index }));
}

async function catalog() {
  const services = await companionDb(
    "services",
    "?select=id,name,category,icon,default_price,enabled,allow_order&order=sort.asc&limit=200"
  ).catch(() => []);
  const products = await companionDb(
    "gameplay_products",
    "?select=id,name,category,price,status,deleted_at,sort_order&order=sort_order.asc&limit=200"
  ).catch(() => []);
  const serviceRows = (Array.isArray(services) ? services : []).filter((row) => row && row.enabled !== false && row.allow_order !== false);
  const productRows = (Array.isArray(products) ? products : []).filter((row) => {
    if (!row || row.deleted_at) return false;
    const status = String(row.status || "").toLowerCase();
    return !status || status === "published" || status === "active" || status === "enabled";
  });
  return { serviceRows, productRows };
}

export async function listCompanionOffers(userId, { enabledOnly = false } = {}) {
  const loaded = await loadCompanionServiceStandards(userId);
  const raw = loaded.standards?.[OFFER_KEY];
  const saved = cleanOffers(raw);
  const { serviceRows, productRows } = await catalog();
  const serviceMap = new Map(serviceRows.map((row) => [String(row.id), row]));
  const productMap = new Map(productRows.map((row) => [String(row.id), row]));
  const offers = saved
    .map((item) => {
      if (item.kind === "product") {
        const row = productMap.get(item.id);
        if (!row) return null;
        return {
          ...item,
          name: row.name || "更多玩法",
          category: row.category || "",
          price: row.price,
          href: "",
        };
      }
      const row = serviceMap.get(item.id);
      if (!row) return null;
      return {
        ...item,
        name: row.name || "服务",
        category: row.category || "",
        price: row.default_price,
        href: "",
      };
    })
    .filter(Boolean);
  return {
    offers: enabledOnly ? offers.filter((item) => item.enabled) : offers,
    catalog: {
      services: serviceRows.map((row) => ({
        kind: "service",
        id: row.id,
        name: row.name,
        category: row.category || "",
        price: row.default_price,
      })),
      products: productRows.map((row) => ({
        kind: "product",
        id: row.id,
        name: row.name,
        category: row.category || "",
        price: row.price,
      })),
    },
  };
}

export async function saveCompanionOffers(userId, offers) {
  const id = String(userId || "").trim();
  if (!id) throw Object.assign(new Error("缺少陪玩账号"), { status: 400 });
  const wanted = cleanOffers(offers);
  const { serviceRows, productRows } = await catalog();
  const allowed = new Set([
    ...serviceRows.map((row) => `service:${row.id}`),
    ...productRows.map((row) => `product:${row.id}`),
  ]);
  const rejected = wanted.filter((item) => !allowed.has(`${item.kind}:${item.id}`));
  if (rejected.length) {
    throw Object.assign(new Error("只能添加平台已启用、且允许陪玩选择的服务或玩法"), { status: 400 });
  }
  const loaded = await loadCompanionServiceStandards(id);
  if (!loaded.available) {
    throw Object.assign(new Error("陪玩资料尚未就绪，暂时不能保存服务"), { status: 503 });
  }
  const next = { ...loaded.standards, [OFFER_KEY]: wanted };
  await companionDb("companion_profiles", `?user_id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ service_standards: next, updated_at: new Date().toISOString() }),
  });
  return listCompanionOffers(id);
}
