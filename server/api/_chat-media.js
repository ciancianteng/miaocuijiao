/**
 * Chat image upload helper (public Storage bucket chat-images).
 */
import { randomUUID } from "node:crypto";
import {
  companionServiceHeaders,
  decodeDataUrl,
  ensurePublicBucket,
  publicObjectUrl,
} from "./_companion-media-store.js";

const CHAT_BUCKET = "chat-images";
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function assertChatImage(decoded) {
  if (!decoded || !decoded.buffer) {
    throw Object.assign(new Error("文件格式无效，请选择 jpg / png / jpeg / webp"), { status: 400 });
  }
  const mime = String(decoded.contentType || "").toLowerCase();
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  if (!ALLOWED.has(normalized) && !ALLOWED.has(mime)) {
    throw Object.assign(new Error("仅支持 jpg、jpeg、png、webp"), { status: 400 });
  }
  if (decoded.buffer.length > MAX_CHAT_IMAGE_BYTES) {
    throw Object.assign(new Error("单张图片不能超过 10MB"), { status: 413 });
  }
  return { ...decoded, contentType: normalized === "image/jpg" ? "image/jpeg" : normalized || "image/jpeg" };
}

export async function uploadChatImageBuffer({ userId, buffer, contentType, filename }) {
  await ensurePublicBucket(CHAT_BUCKET, ["image/jpeg", "image/png", "image/webp"]);
  const ext =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const safeName = String(filename || `chat.${ext}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
  const objectPath = `${userId || "anon"}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${CHAT_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      ...companionServiceHeaders({
        "Content-Type": contentType || "image/jpeg",
        "x-upsert": "true",
      }),
    },
    body: buffer,
  });
  const text = await response.text();
  if (!response.ok) throw Object.assign(new Error(`上传失败：${text || response.status}`), { status: 500 });
  const url = publicObjectUrl(CHAT_BUCKET, objectPath);
  return { bucket: CHAT_BUCKET, path: objectPath, url };
}

export async function uploadChatImageDataUrl({ userId, dataUrl, filename }) {
  const decoded = assertChatImage(decodeDataUrl(dataUrl));
  return uploadChatImageBuffer({
    userId,
    buffer: decoded.buffer,
    contentType: decoded.contentType,
    filename,
  });
}

export { CHAT_BUCKET, MAX_CHAT_IMAGE_BYTES };
