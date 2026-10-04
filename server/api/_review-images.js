import {
  assertImageUpload,
  buildObjectPath,
  companionServiceHeaders,
  decodeDataUrl,
  ensurePublicBucket,
  publicObjectUrl,
} from "./_companion-media-store.js";

export const REVIEW_IMAGE_BUCKET = "review-images";
export const REVIEW_IMAGE_MAX_COUNT = 3;
export const REVIEW_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const REVIEW_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

let bucketReady = false;

async function ensureReviewImageBucket() {
  if (bucketReady) return;
  await ensurePublicBucket(REVIEW_IMAGE_BUCKET, REVIEW_IMAGE_MIMES);
  bucketReady = true;
}

function reviewFolder(bossId, orderId) {
  return `${bossId}/reviews/${orderId}/`;
}

export async function uploadReviewImage({ bossId, orderId, dataUrl }) {
  const raw = String(dataUrl || "");
  if (!raw.startsWith("data:image/")) {
    throw Object.assign(new Error("请选择 jpg / png / webp 图片"), { status: 400 });
  }
  const decoded = assertImageUpload(decodeDataUrl(raw));
  if (decoded.buffer.length > REVIEW_IMAGE_MAX_BYTES) {
    throw Object.assign(new Error("单张图片不能超过 2MB"), { status: 413 });
  }
  await ensureReviewImageBucket();
  const ext = EXT_BY_MIME[decoded.contentType] || "jpg";
  const objectPath = buildObjectPath(bossId, `reviews/${orderId}`, `review.${ext}`);
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${REVIEW_IMAGE_BUCKET}/${objectPath}`,
    {
      method: "POST",
      headers: companionServiceHeaders({ "Content-Type": decoded.contentType, "x-upsert": "false" }),
      body: decoded.buffer,
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw Object.assign(new Error(`图片上传失败：${text || response.status}`), { status: 502 });
  }
  return { url: publicObjectUrl(REVIEW_IMAGE_BUCKET, objectPath), path: objectPath };
}

/** Keep only public URLs this boss uploaded for this order (max 3, deduped). */
export function sanitizeReviewImageUrls(list, { bossId, orderId }) {
  const prefix = publicObjectUrl(REVIEW_IMAGE_BUCKET, reviewFolder(bossId, orderId));
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const url = String(item || "").trim();
    if (!url || !url.startsWith(prefix) || url.includes("..") || out.includes(url)) continue;
    out.push(url);
    if (out.length >= REVIEW_IMAGE_MAX_COUNT) break;
  }
  return out;
}

export function normalizeReviewImages(value) {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return (Array.isArray(list) ? list : [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https:\/\//i.test(u))
    .slice(0, REVIEW_IMAGE_MAX_COUNT);
}

export function isMissingReviewImagesColumn(error) {
  const text = String(error?.message || error || "");
  return /image_urls/i.test(text) && /column|schema cache|PGRST204|42703|does not exist/i.test(text);
}
