/**
 * Production-public share card (WeChat / iMessage / Twitter).
 * Crawlers do not execute JS, so these tags must be static HTML.
 */
export const PROD_ORIGIN = "https://www.meowcuijiao.com";
export const OG_IMAGE = `${PROD_ORIGIN}/og/share-card-square-v2.jpg`;
export const OG_IMAGE_TYPE = "image/jpeg";
export const OG_IMAGE_WIDTH = "1200";
export const OG_IMAGE_HEIGHT = "1200";
export const OG_IMAGE_ALT = "MEOW CUI JIAO 官方猫头像";
export const OG_SITE_NAME = "妙脆角 MEOW CUI JIAO";

export const BEGIN = "<!-- mcj-og-meta:begin -->";
export const END = "<!-- mcj-og-meta:end -->";

const FORBIDDEN_IMAGE_RE =
  /localhost|127\.0\.0\.1|vercel\.app|supabase\.co\/storage|blob:|file:|preview/i;

export function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function portalOf(relPath) {
  const p = String(relPath || "").replace(/\\/g, "/");
  if (p.startsWith("companion/")) return "companion";
  if (p.startsWith("customer-service/") || p === "customer-service.html") return "cs";
  if (p.startsWith("admin/") || /^admin(-|\.html$)/.test(p) || p === "admin.html") return "admin";
  return "boss";
}

export function descriptionFor(relPath, title) {
  const portal = portalOf(relPath);
  if (portal === "companion") return "妙脆角陪玩端 — 工作台、抢单、订单、收益。";
  if (portal === "cs") return "妙脆角客服端 — 派单、会话、售后。";
  if (portal === "admin") return "妙脆角后台中心 — 订单、审核、运营。";
  return "专业陪玩，每一场游戏认真对待每一位热爱电竞的你。";
}

export function canonicalFor(relPath) {
  const p = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (p === "index.html") return `${PROD_ORIGIN}/`;
  if (p.endsWith("/index.html")) {
    return `${PROD_ORIGIN}/${p.slice(0, -"index.html".length)}`;
  }
  return `${PROD_ORIGIN}/${p}`;
}

export function isForbiddenShareImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return true;
  if (!/^https:\/\//i.test(raw)) return true;
  if (FORBIDDEN_IMAGE_RE.test(raw)) return true;
  if (/^https:\/\/www\.meowcuijiao\.com\/og\/share-card/i.test(raw)) return false;
  return !/^https:\/\/www\.meowcuijiao\.com\//i.test(raw);
}

export function ogMetaBlock({ title, url, description }) {
  const t = escapeAttr(title);
  const u = escapeAttr(url);
  const d = escapeAttr(description);
  const img = escapeAttr(OG_IMAGE);
  return [
    `  ${BEGIN}`,
    `  <link rel="canonical" href="${u}">`,
    `  <meta name="description" content="${d}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:site_name" content="${escapeAttr(OG_SITE_NAME)}">`,
    `  <meta property="og:locale" content="zh_CN">`,
    `  <meta property="og:url" content="${u}">`,
    `  <meta property="og:title" content="${t}">`,
    `  <meta property="og:description" content="${d}">`,
    `  <meta property="og:image" content="${img}">`,
    `  <meta property="og:image:secure_url" content="${img}">`,
    `  <meta property="og:image:type" content="${OG_IMAGE_TYPE}">`,
    `  <meta property="og:image:width" content="${OG_IMAGE_WIDTH}">`,
    `  <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">`,
    `  <meta property="og:image:alt" content="${escapeAttr(OG_IMAGE_ALT)}">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${t}">`,
    `  <meta name="twitter:description" content="${d}">`,
    `  <meta name="twitter:image" content="${img}">`,
    `  <link rel="image_src" href="${img}">`,
    `  ${END}`,
  ].join("\n");
}

export function extractTitle(html) {
  const m = String(html || "").match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : "MEOW CUI JIAO";
}

export function upsertOgBlock(html, relPath) {
  const title = extractTitle(html);
  const block = ogMetaBlock({
    title,
    url: canonicalFor(relPath),
    description: descriptionFor(relPath, title),
  });
  const src = String(html || "");
  if (src.includes(BEGIN) && src.includes(END)) {
    return src.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block.trim());
  }
  if (/<\/title>/i.test(src)) {
    return src.replace(/<\/title>/i, `</title>\n${block}`);
  }
  if (src.includes("<!-- mcj-pwa-meta:end -->")) {
    return src.replace("<!-- mcj-pwa-meta:end -->", `<!-- mcj-pwa-meta:end -->\n${block}`);
  }
  return src.replace(/<head[^>]*>/i, (open) => `${open}\n${block}`);
}

export function homepageTwitterAddon() {
  const img = escapeAttr(OG_IMAGE);
  return [
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="MEOW CUI JIAO GAMING CLUB">`,
    `  <meta name="twitter:description" content="专业陪玩，每一场游戏认真对待每一位热爱电竞的你。">`,
    `  <meta name="twitter:image" content="${img}">`,
    `  <link rel="image_src" href="${img}">`,
  ].join("\n");
}

export const FOUR_ENTRY_HTML = Object.freeze([
  { rel: "index.html", label: "老板/主页", expectTitle: "MEOW CUI JIAO GAMING CLUB" },
  { rel: "companion/login/index.html", label: "陪玩端登录", expectTitle: "陪玩登录 | MEOW CUI JIAO" },
  { rel: "customer-service/login/index.html", label: "客服端登录", expectTitle: "客服端登录 | MEOW CUI JIAO" },
  { rel: "admin/login/index.html", label: "后台端登录", expectTitle: "后台中心登录 | 妙脆角" },
]);
