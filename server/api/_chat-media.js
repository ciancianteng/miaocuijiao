/**
 * Chat image upload helper — private Storage + conversation-scoped paths.
 * New uploads go to chat-images-private; clients only receive short-lived signed URLs
 * after the API verifies conversation membership.
 */
import { randomUUID } from "node:crypto";
import {
  companionServiceHeaders,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
} from "./_companion-media-store.js";

const CHAT_BUCKET = "chat-images-private";
const LEGACY_PUBLIC_BUCKET = "chat-images";
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

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function loadConversation(conversationId) {
  const cid = String(conversationId || "").trim();
  if (!cid) return null;
  const response = await fetch(restUrl("conversations", `?id=eq.${encodeURIComponent(cid)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) return null;
  return Array.isArray(body) ? body[0] : null;
}

/**
 * Viewer must be boss / companion / assigned CS / admin of this conversation side.
 */
export async function assertChatMediaAccess(conversation, userId, profileRole = "") {
  const uid = String(userId || "").trim();
  if (!uid || !conversation?.id) {
    throw Object.assign(new Error("无权访问该聊天图片"), { status: 403 });
  }
  const role = String(profileRole || "").toLowerCase();
  if (role === "admin" || role === "super_admin") return true;
  if (role === "customer_service" || role === "service") return true;
  if (String(conversation.boss_id || "") === uid) return true;
  if (String(conversation.companion_id || "") === uid) {
    const { isCompanionCsConversation } = await import("./_conversation-privacy.js");
    if (!isCompanionCsConversation(conversation)) {
      throw Object.assign(new Error("无权访问该聊天图片"), { status: 403 });
    }
    return true;
  }
  if (String(conversation.customer_service_id || "") === uid) return true;
  throw Object.assign(new Error("无权访问该聊天图片"), { status: 403 });
}

export async function uploadChatImageBuffer({ userId, conversationId, buffer, contentType, filename, profileRole = "" }) {
  const conversation = await loadConversation(conversationId);
  if (!conversation) throw Object.assign(new Error("会话不存在，无法上传图片"), { status: 404 });
  await assertChatMediaAccess(conversation, userId, profileRole);

  await ensurePrivateBucket(CHAT_BUCKET, ["image/jpeg", "image/png", "image/webp"]);
  const ext =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const safeName = String(filename || `chat.${ext}`)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
  const objectPath = `conv/${conversation.id}/${userId || "anon"}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
  await uploadPrivateObject(CHAT_BUCKET, objectPath, buffer, contentType || "image/jpeg");
  const signedUrl = await createSignedUrl(CHAT_BUCKET, objectPath, 60 * 30);
  return {
    bucket: CHAT_BUCKET,
    path: objectPath,
    url: signedUrl,
    // Stable private reference for DB content (signed at read time).
    storageRef: `${CHAT_BUCKET}:${objectPath}`,
  };
}

export async function uploadChatImageDataUrl({ userId, conversationId, dataUrl, filename, profileRole = "" }) {
  const decoded = assertChatImage(decodeDataUrl(dataUrl));
  return uploadChatImageBuffer({
    userId,
    conversationId,
    buffer: decoded.buffer,
    contentType: decoded.contentType,
    filename,
    profileRole,
  });
}

export function parseChatStorageRef(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const privateRef = s.match(/^chat-images-private:(.+)$/i);
  if (privateRef) return { bucket: CHAT_BUCKET, path: privateRef[1] };
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/(chat-images(?:-private)?)\/([^?]+)/i);
  if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  if (/^conv\//.test(s)) return { bucket: CHAT_BUCKET, path: s };
  return null;
}

export async function signChatMediaUrl(raw, { expiresIn = 60 * 30 } = {}) {
  const parsed = parseChatStorageRef(raw);
  if (!parsed) return String(raw || "");
  if (parsed.bucket === LEGACY_PUBLIC_BUCKET) {
    // Legacy public objects: keep absolute public URL if already https.
    if (/^https?:\/\//i.test(String(raw || ""))) return String(raw);
    return `${process.env.SUPABASE_URL}/storage/v1/object/public/${LEGACY_PUBLIC_BUCKET}/${parsed.path}`;
  }
  try {
    return (await createSignedUrl(parsed.bucket, parsed.path, expiresIn)) || String(raw || "");
  } catch {
    return String(raw || "");
  }
}

export { CHAT_BUCKET, LEGACY_PUBLIC_BUCKET, MAX_CHAT_IMAGE_BYTES, companionServiceHeaders };
