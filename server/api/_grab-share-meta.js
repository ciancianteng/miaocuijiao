/**
 * Public Open Graph + landing meta for one grab-hall order share link.
 * Never includes boss private fields, game IDs, payment proofs, or CS internals.
 */

import { escapeShareAttr, shareOrigin, SHARE_BRAND, BRAND_SHARE_IMAGE_PATH } from "./_companion-share-meta.js";
import { isPublicHallEligible, sanitizeHallOrderView, stripInternalMarkers } from "./_order-assignment.js";

export function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

export function grabShareUrl(origin, orderId) {
  const base = shareOrigin(origin);
  const id = String(orderId || "").trim();
  return id ? `${base}/g/${encodeURIComponent(id)}` : `${base}/companion/order-hall/`;
}

export function buildGrabShareMeta({ origin, order } = {}) {
  const base = shareOrigin(origin);
  const id = String(order?.id || "").trim();
  const game = String(order?.game || "").trim() || "电竞陪玩";
  const service = String(order?.serviceName || order?.serviceType || order?.title || "陪玩服务").trim();
  const hours = order?.hours != null && order?.hours !== "" ? `${order.hours} 小时` : "";
  const amount = Number(order?.playerIncome || order?.companionIncome || order?.amount || order?.totalAmount || 0) || 0;
  const status = String(order?.statusText || order?.status || "抢单中");
  const title = `${game} · ${service}｜抢单中 · ${SHARE_BRAND}`;
  const payHint = amount > 0 ? `陪玩可获约 ${amount} 猫粮` : "查看报酬后进入抢单";
  const description = [game, service, hours, payHint, `状态：${status}`, "进入抢单"].filter(Boolean).join(" · ");
  const url = grabShareUrl(base, id);
  return {
    orderId: id,
    title,
    description,
    url,
    image: `${base}${BRAND_SHARE_IMAGE_PATH}`,
    imageAlt: `${SHARE_BRAND} 抢单订单`,
    cta: "进入抢单",
    game,
    service,
    hours,
    amount,
    status,
  };
}

export function publicGrabCardFromOrder(row) {
  if (!row?.id) return null;
  const st = String(row.status || "").toLowerCase();
  const closed = ["cancelled", "completed", "reviewed", "refunded", "refund_requested", "claimed", "confirmed", "in_progress"].includes(st);
  const hallOpen = isPublicHallEligible(row);
  const hours = row.hours != null ? Number(row.hours) : null;
  const amount = Number(row.total_amount || row.totalAmount || 0) || 0;
  const companionIncome = Number(row.companion_income || row.companionIncome || 0) || 0;
  const playerIncome = companionIncome > 0 ? companionIncome : Math.round(amount * 0.8 * 100) / 100;
  const statusText = hallOpen
    ? st === "waiting_boss_confirm"
      ? "抢单中（已有人抢）"
      : "抢单中"
    : closed
      ? st === "cancelled"
        ? "已取消"
        : st === "claimed" || st === "confirmed" || st === "in_progress" || st === "completed" || st === "reviewed"
          ? "已被抢走"
          : "已结束"
      : "不可抢单";
  const viewed = sanitizeHallOrderView({
    id: row.id,
    orderNo: row.order_no || row.orderNo || "",
    game: row.game || "",
    serviceContent: stripInternalMarkers(row.description || row.title || ""),
    serviceName: row.title || row.game || "陪玩服务",
    serviceType: row.order_type || "",
    hours,
    duration: hours != null ? `${hours} 小时` : "-",
    amount,
    playerIncome,
    status: row.status,
    statusText,
    hallState: hallOpen ? "grabbing" : closed ? "settled" : "closed",
    canGrab: hallOpen,
  });
  return {
    ...viewed,
    canGrab: hallOpen,
    statusText,
    playerIncome,
    amount,
  };
}

const BLOCK_BEGIN = "<!-- mcj-grab-og:begin -->";
const BLOCK_END = "<!-- mcj-grab-og:end -->";

export function grabShareMetaBlock(meta) {
  const title = escapeShareAttr(meta.title);
  const description = escapeShareAttr(meta.description);
  const url = escapeShareAttr(meta.url);
  const image = escapeShareAttr(meta.image);
  const alt = escapeShareAttr(meta.imageAlt || meta.title);
  return [
    BLOCK_BEGIN,
    `  <link rel="canonical" href="${url}">`,
    `  <meta name="description" content="${description}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:site_name" content="${escapeShareAttr(SHARE_BRAND)}">`,
    `  <meta property="og:locale" content="zh_CN">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:title" content="${title}">`,
    `  <meta property="og:description" content="${description}">`,
    `  <meta property="og:image" content="${image}">`,
    `  <meta property="og:image:secure_url" content="${image}">`,
    `  <meta property="og:image:type" content="image/jpeg">`,
    `  <meta property="og:image:width" content="1200">`,
    `  <meta property="og:image:height" content="1200">`,
    `  <meta property="og:image:alt" content="${alt}">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${title}">`,
    `  <meta name="twitter:description" content="${description}">`,
    `  <meta name="twitter:image" content="${image}">`,
    BLOCK_END,
  ].join("\n");
}

export function applyGrabShareHtml(template, meta) {
  let html = String(template || "");
  const block = grabShareMetaBlock(meta);
  if (html.includes(BLOCK_BEGIN) && html.includes(BLOCK_END)) {
    html = html.replace(new RegExp(`${BLOCK_BEGIN}[\\s\\S]*?${BLOCK_END}`), block);
  } else if (html.includes("</head>")) {
    html = html.replace("</head>", `${block}\n</head>`);
  }
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeShareAttr(meta.title)}</title>`);
  return html;
}
