import fs from "node:fs";
import path from "node:path";
import {
  CATEGORIES,
  PRICING_UNITS,
  fromDbRow,
  toPublicProduct,
  readLocalProducts,
} from "../_gameplay-products-store.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function serviceHeaders() {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0" };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function isMissingTable(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text);
}

async function listPublished() {
  if (hasDb()) {
    try {
      const response = await fetch(
        restUrl("gameplay_products", "?status=eq.published&deleted_at=is.null&order=featured.desc,sort_order.asc,updated_at.desc"),
        { headers: serviceHeaders() }
      );
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!response.ok) {
        throw Object.assign(new Error(body?.message || "读取商品失败"), { status: response.status, body });
      }
      return {
        products: (Array.isArray(body) ? body : []).map(fromDbRow).map((item) => toPublicProduct(item)),
        source: "supabase",
      };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }
    // Fallback: Preview TEST products stored in announcements (no gameplay_products table yet).
    try {
      const response = await fetch(
        restUrl("announcements", `?is_active=eq.true&title=like.${encodeURIComponent("*[MCJ_GP]*")}&limit=20`),
        { headers: serviceHeaders() }
      );
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (response.ok && Array.isArray(body) && body.length) {
        const products = body
          .map((row) => {
            try {
              return JSON.parse(row.content || "{}");
            } catch {
              return null;
            }
          })
          .filter((item) => item && item.name)
          .map((item) => toPublicProduct(item));
        if (products.length) return { products, source: "announcements" };
      }
      // PostgREST like may fail; scan recent announcements
      const scan = await fetch(restUrl("announcements", "?is_active=eq.true&order=updated_at.desc&limit=50"), {
        headers: serviceHeaders(),
      });
      const scanText = await scan.text();
      let scanBody = null;
      try {
        scanBody = scanText ? JSON.parse(scanText) : null;
      } catch {
        scanBody = null;
      }
      if (scan.ok && Array.isArray(scanBody)) {
        const products = scanBody
          .filter((row) => String(row.title || "").includes("[MCJ_GP]"))
          .map((row) => {
            try {
              return JSON.parse(row.content || "{}");
            } catch {
              return null;
            }
          })
          .filter((item) => item && item.name)
          .map((item) => toPublicProduct(item));
        if (products.length) return { products, source: "announcements" };
      }
    } catch {
      /* ignore */
    }
    return { products: [], source: "supabase-empty" };
  }
  try {
    const rows = await readLocalProducts();
    return {
      products: rows.filter((item) => item.status === "published").map((item) => toPublicProduct(item)),
      source: "local",
    };
  } catch {
    return { products: [], source: "local-empty" };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const id = String(req.query.id || "").trim();
    const result = await listPublished();
    if (id) {
      const product = result.products.find((item) => String(item.id) === id) || null;
      if (!product) return json(res, 404, { ok: false, message: "商品不存在或已下架。" });
      return json(res, 200, { ok: true, product, categories: CATEGORIES, pricingUnits: PRICING_UNITS, source: result.source });
    }
    return json(res, 200, {
      ok: true,
      products: result.products,
      categories: CATEGORIES,
      pricingUnits: PRICING_UNITS,
      source: result.source,
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "更多玩法商城读取失败" });
  }
}
