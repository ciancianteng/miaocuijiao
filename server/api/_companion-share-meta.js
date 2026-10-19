/**
 * Open Graph for one companion share URL.
 * Crawlers never run the profile page script, so this stays pure data.
 */

export const SHARE_BRAND = "MEOW CUI JIAO";
export const BRAND_SHARE_IMAGE_PATH = "/og/share-card-square-v2.jpg";

export function normalizeShareCode(raw) {
  const id = String(raw || "").trim().toUpperCase();
  return /^PW\d+$/.test(id) ? id : "";
}

export function escapeShareAttr(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function shareOrigin(input) {
  const fallback = "https://www.meowcuijiao.com";
  try {
    const url = new URL(String(input || "").trim());
    if (url.protocol !== "https:") return fallback;
    const host = url.hostname.toLowerCase();
    if (host === "www.meowcuijiao.com" || host === "meowcuijiao.com") return `https://${host}`;
    if (host.endsWith(".vercel.app") && host.includes("meow-cuijiao-homepage")) return `https://${host}`;
    return fallback;
  } catch {
    return fallback;
  }
}

export function companionShareTitle(nickname) {
  const name = String(nickname || "").trim() || "陪玩";
  return `${name}｜陪玩资料 · ${SHARE_BRAND}`;
}

export function companionShareDescription(nickname) {
  const name = String(nickname || "").trim() || "陪玩";
  return `查看${name}的陪玩资料，声线、照片与服务。`;
}

export function buildCompanionShareMeta({ origin, publicId, nickname } = {}) {
  const code = normalizeShareCode(publicId);
  const base = shareOrigin(origin);
  const name = String(nickname || "").trim();
  const title = companionShareTitle(name);
  const description = companionShareDescription(name);
  const url = code ? `${base}/companion/${code}` : `${base}/profile.html`;
  const image = code
    ? `${base}/api/public/companion-og-image?code=${encodeURIComponent(code)}`
    : `${base}${BRAND_SHARE_IMAGE_PATH}`;
  return {
    publicId: code,
    nickname: name || "陪玩",
    title,
    description,
    url,
    image,
    imageAlt: `${name || "陪玩"}的头像`,
  };
}

const BLOCK_BEGIN = "<!-- mcj-companion-og:begin -->";
const BLOCK_END = "<!-- mcj-companion-og:end -->";

export function companionShareMetaBlock(meta) {
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
    `  <meta property="og:site_name" content="妙脆角 ${SHARE_BRAND}">`,
    `  <meta property="og:locale" content="zh_CN">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:title" content="${title}">`,
    `  <meta property="og:description" content="${description}">`,
    `  <meta property="og:image" content="${image}">`,
    `  <meta property="og:image:secure_url" content="${image}">`,
    `  <meta property="og:image:alt" content="${alt}">`,
    `  <meta name="twitter:card" content="summary">`,
    `  <meta name="twitter:title" content="${title}">`,
    `  <meta name="twitter:description" content="${description}">`,
    `  <meta name="twitter:image" content="${image}">`,
    BLOCK_END,
  ].join("\n");
}

export function applyCompanionShareHtml(html, meta) {
  const title = escapeShareAttr(meta.title);
  const block = companionShareMetaBlock(meta);
  let out = String(html || "");
  if (out.includes(BLOCK_BEGIN) && out.includes(BLOCK_END)) {
    out = out.replace(new RegExp(`${BLOCK_BEGIN}[\\s\\S]*?${BLOCK_END}`), block);
  }
  if (/<title>[^<]*<\/title>/i.test(out)) {
    out = out.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  }
  if (!out.includes(BLOCK_BEGIN)) {
    if (/<\/title>/i.test(out)) out = out.replace(/<\/title>/i, `</title>\n  ${block}`);
    else out = out.replace(/<head[^>]*>/i, (open) => `${open}\n  ${block}`);
  }
  return out;
}
