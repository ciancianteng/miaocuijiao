/**
 * HTML for /g/:orderId — WeChat/H5 link preview + public grab landing.
 * Loads only public hall-safe fields (no boss private data).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyGrabShareHtml,
  buildGrabShareMeta,
  grabShareUrl,
  isUuid,
  publicGrabCardFromOrder,
} from "./_grab-share-meta.js";
import { shareOrigin as normalizeOrigin } from "./_companion-share-meta.js";

let template = "";

function readTemplate() {
  if (!template) {
    template = readFileSync(join(process.cwd(), "grab-order.html"), "utf8");
  }
  return template;
}

function requestOrderId(req) {
  const q = req?.query || {};
  const fromQuery = q.id || q.orderId || q.order_id || "";
  if (fromQuery && isUuid(fromQuery)) return String(fromQuery);
  try {
    const url = new URL(req?.url || "/", "http://localhost");
    const id = url.searchParams.get("id") || url.searchParams.get("orderId") || "";
    if (isUuid(id)) return id;
  } catch (_) {}
  return "";
}

function requestOrigin(req) {
  const headers = req?.headers || {};
  const hinted = String(req?.query?.host || headers["x-mcj-share-host"] || "")
    .split(",")[0]
    .trim();
  if (hinted) return normalizeOrigin(`https://${hinted}`);
  const host = String(headers["x-forwarded-host"] || headers.host || "")
    .split(",")[0]
    .trim();
  const proto = String(headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  if (!host) return "https://www.meowcuijiao.com";
  return normalizeOrigin(`${proto}://${host}`);
}

async function loadOrder(orderId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !isUuid(orderId)) return null;
  const endpoint = `${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_no,status,game,title,description,hours,total_amount,companion_income,companion_id,assignment_type,order_type,note&limit=1`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

export default async function handler(req, res) {
  const orderId = requestOrderId(req);
  const origin = requestOrigin(req);
  let card = null;
  if (orderId) {
    try {
      const row = await loadOrder(orderId);
      card = publicGrabCardFromOrder(row);
    } catch (error) {
      console.warn("[grab-share] lookup failed", orderId, error?.message || error);
    }
  }
  const meta = buildGrabShareMeta({ origin, order: card || { id: orderId } });
  let html = applyGrabShareHtml(readTemplate(), meta);
  const payload = {
    ok: true,
    order: card,
    meta: {
      title: meta.title,
      description: meta.description,
      url: meta.url,
      cta: meta.cta,
      nativeWeChatShare: false,
      note: "未配置微信 JS-SDK / 未验证域名时仅支持 H5 链接与网页预览，不提供原生分享卡片。",
    },
    hallUrl: `${normalizeOrigin(origin)}/companion/order-hall/?order=${encodeURIComponent(orderId || "")}`,
    shareUrl: grabShareUrl(origin, orderId),
  };
  html = html.replace(
    "<!-- mcj-grab-payload -->",
    `<script type="application/json" id="mcjGrabSharePayload">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`
  );
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}
