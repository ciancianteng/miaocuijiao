import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const PRIVATE_BUCKETS = {
  identity: "companion-identities",
  gallery: "companion-gallery",
  audio: "companion-audio",
  video: "companion-video",
  payment: "companion-payment-proofs",
};

const PUBLIC_BUCKETS = {
  profile: "companion-public",
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

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

export function hasCompanionDb() {
  return REQUIRED_ENV.every((key) => !!process.env[key]);
}

export function companionServiceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Always send both apikey + Authorization. Omitting Bearer for sb_secret_
  // keys caused PostgREST to run as anon → empty profile rows → false 403s
  // like「没有陪玩管理权限」on admin detail while list looked fine in UI.
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
}

export function companionRestUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

export async function companionDb(table, query = "", init = {}) {
  const response = await fetch(companionRestUrl(table, query), {
    ...init,
    headers: { ...companionServiceHeaders(), ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      stringifyApiErrorValue(body?.error_description) ||
      stringifyApiErrorValue(body?.msg) ||
      stringifyApiErrorValue(body?.message) ||
      stringifyApiErrorValue(body?.error) ||
      stringifyApiErrorValue(body?.hint) ||
      stringifyApiErrorValue(body?.details) ||
      (body?.code ? `code=${body.code}` : "") ||
      (typeof body === "string" ? body.slice(0, 240) : "") ||
      `Supabase 请求失败 (HTTP ${response.status}; ${table}${query ? "?" + String(query).slice(0, 80) : ""})`;
    throw Object.assign(new Error(message), { status: response.status, body, table });
  }
  return body;
}

export function isMissingRelation(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /PGRST205|Could not find the table|schema cache|does not exist/i.test(text);
}

export function decodeDataUrl(dataUrl) {
  // Support MediaRecorder types like data:audio/webm;codecs=opus;base64,...
  // (old regex only matched data:<type>;base64, and rejected codecs parameters).
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:([^,]*),(.*)$/i);
  if (!match) return null;
  const meta = String(match[1] || "");
  const payload = String(match[2] || "");
  if (!payload) return null;
  const parts = meta.split(";").map((p) => p.trim()).filter(Boolean);
  const isBase64 = parts.some((p) => /^base64$/i.test(p));
  const contentType = parts.find((p) => p.includes("/")) || "application/octet-stream";
  try {
    const buffer = isBase64
      ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    if (!buffer.length) return null;
    return { contentType, buffer };
  } catch {
    return null;
  }
}

async function listBuckets() {
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    headers: companionServiceHeaders(),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(text || `读取 Storage 桶失败 HTTP ${response.status}`);
  return Array.isArray(body) ? body : [];
}

export async function ensurePrivateBucket(bucket, mimeTypes, fileSizeLimit = 20 * 1024 * 1024) {
  const list = await listBuckets();
  const existing = (list || []).find((item) => item && (item.id === bucket || item.name === bucket));
  if (existing) {
    // Keep MIME allowlist current (e.g. companion-video needs video/*).
    try {
      await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket/${bucket}`, {
        method: "PUT",
        headers: companionServiceHeaders(),
        body: JSON.stringify({
          public: false,
          file_size_limit: fileSizeLimit,
          allowed_mime_types: mimeTypes,
        }),
      });
    } catch {
      /* best-effort */
    }
    return bucket;
  }
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: companionServiceHeaders(),
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: fileSizeLimit,
      allowed_mime_types: mimeTypes,
    }),
  });
  const text = await response.text();
  if (!response.ok && !/already exists|duplicate/i.test(text)) {
    throw new Error(`创建私有桶 ${bucket} 失败：${text || response.status}`);
  }
  return bucket;
}

export async function ensurePublicBucket(bucket, mimeTypes) {
  const list = await listBuckets();
  const exists = list.some((item) => item && (item.id === bucket || item.name === bucket));
  if (exists) return bucket;
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: companionServiceHeaders(),
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_IMAGE_BYTES,
      allowed_mime_types: mimeTypes,
    }),
  });
  const text = await response.text();
  if (!response.ok && !/already exists|duplicate/i.test(text)) {
    throw new Error(`创建公开桶 ${bucket} 失败：${text || response.status}`);
  }
  return bucket;
}

export async function ensureCompanionBuckets() {
  await ensurePrivateBucket(PRIVATE_BUCKETS.identity, ["image/jpeg", "image/png", "image/webp"]);
  await ensurePrivateBucket(PRIVATE_BUCKETS.gallery, ["image/jpeg", "image/png", "image/webp"]);
  await ensurePrivateBucket(PRIVATE_BUCKETS.audio, [
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
    "audio/ogg",
    "audio/x-m4a",
  ]);
  await ensurePrivateBucket(
    PRIVATE_BUCKETS.video,
    ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "application/octet-stream"],
    50 * 1024 * 1024
  );
  await ensurePrivateBucket(PRIVATE_BUCKETS.payment, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  try {
    await ensurePublicBucket(PUBLIC_BUCKETS.profile, ["image/jpeg", "image/png", "image/webp"]);
  } catch {
    /* public bucket optional; private + signed URL still works */
  }
  return PRIVATE_BUCKETS;
}

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "application/octet-stream",
]);

export function assertVideoMeta({ contentType, byteLength } = {}) {
  const mime = String(contentType || "").toLowerCase().split(";")[0].trim() || "video/mp4";
  const ok = ALLOWED_VIDEO_MIME.has(mime) || /^video\//.test(mime);
  if (!ok) {
    throw Object.assign(new Error("仅支持 mp4 / mov / webm 视频"), { status: 400 });
  }
  const size = Number(byteLength);
  if (Number.isFinite(size) && size > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error("视频不能超过 50MB"), { status: 413 });
  }
  return { contentType: mime.startsWith("video/") ? mime : "video/mp4" };
}

export function assertVideoUpload(decoded) {
  if (!decoded || !decoded.buffer) {
    throw Object.assign(new Error("文件格式无效，请选择 mp4 / mov 视频"), { status: 400 });
  }
  const checked = assertVideoMeta({
    contentType: decoded.contentType,
    byteLength: decoded.buffer.length,
  });
  return {
    ...decoded,
    contentType: checked.contentType,
  };
}

/** Coerce Supabase / nested error values so UI never shows [object Object]. */
export function stringifyApiErrorValue(value, fallback = "") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (typeof value === "object") {
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    if (typeof value.msg === "string" && value.msg.trim()) return value.msg;
    try {
      const s = JSON.stringify(value);
      if (s && s !== "{}" && s !== "null") return s.slice(0, 240);
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

/**
 * Mint a short-lived signed upload URL so the browser can PUT the video
 * straight to Supabase Storage (never through the Vercel function body).
 */
export async function createSignedUploadUrl(bucket, objectPath, expiresIn = 600) {
  await ensureCompanionBuckets();
  const path = String(objectPath || "").replace(/^\/+/, "");
  if (!bucket || !path) {
    throw Object.assign(new Error("缺少上传路径"), { status: 400 });
  }
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}`,
    {
      method: "POST",
      headers: companionServiceHeaders(),
      body: JSON.stringify({ expiresIn: Number(expiresIn) || 600 }),
    }
  );
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(stringifyApiErrorValue(body?.message || body?.error || text, `签发上传凭证失败 HTTP ${response.status}`)),
      { status: response.status, body }
    );
  }
  const token = String(body?.token || "").trim();
  let signedUrl = String(body?.signedUrl || body?.signedURL || body?.url || "").trim();
  if (signedUrl && !/^https?:\/\//i.test(signedUrl)) {
    signedUrl = `${process.env.SUPABASE_URL}/storage/v1${signedUrl.startsWith("/") ? "" : "/"}${signedUrl}`;
  }
  if (!signedUrl && token) {
    signedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}?token=${encodeURIComponent(token)}`;
  }
  if (!signedUrl) {
    throw Object.assign(new Error("签发上传凭证失败：未返回 signedUrl"), { status: 502, body });
  }
  return { bucket, path, token, signedUrl, expiresIn: Number(expiresIn) || 600 };
}

/** Confirm object landed in Storage before writing companion_media metadata. */
export async function assertStorageObjectPresent(bucket, objectPath) {
  const path = String(objectPath || "").replace(/^\/+/, "");
  if (!bucket || !path) {
    throw Object.assign(new Error("缺少存储路径"), { status: 400 });
  }
  // Prefer signed download — fails cleanly when the object is missing.
  try {
    const url = await createSignedUrl(bucket, path, 60);
    if (!url) throw new Error("missing");
    return true;
  } catch (err) {
    throw Object.assign(new Error("视频尚未上传到云端，请重试直传后再提交"), {
      status: 400,
      cause: err,
    });
  }
}

export function publicObjectUrl(bucket, objectPath) {
  if (!bucket || !objectPath) return "";
  if (/^https?:\/\//i.test(objectPath) || String(objectPath).startsWith("data:")) return objectPath;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${String(objectPath).replace(/^\/+/, "")}`;
}

export function assertImageUpload(decoded) {
  if (!decoded || !decoded.buffer) {
    throw Object.assign(new Error("文件格式无效，请选择 jpg / png / webp 图片"), { status: 400 });
  }
  const mime = String(decoded.contentType || "").toLowerCase();
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  if (!ALLOWED_IMAGE_MIME.has(normalized) && !ALLOWED_IMAGE_MIME.has(mime)) {
    throw Object.assign(new Error("仅支持 jpg、jpeg、png、webp 格式"), { status: 400 });
  }
  if (decoded.buffer.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("单张图片不能超过 10MB"), { status: 413 });
  }
  return { ...decoded, contentType: normalized === "image/jpg" ? "image/jpeg" : normalized || "image/jpeg" };
}

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/aac",
  "application/octet-stream",
]);

export function assertAudioUpload(decoded) {
  if (!decoded || !decoded.buffer) {
    throw Object.assign(new Error("文件格式无效，请选择语音文件（webm / mp3 / wav）"), { status: 400 });
  }
  // Strip codec / parameter suffixes for Storage allowlists (audio/webm;codecs=opus → audio/webm).
  const rawMime = String(decoded.contentType || "").toLowerCase() || "audio/webm";
  const mime = rawMime.split(";")[0].trim() || "audio/webm";
  const ok =
    ALLOWED_AUDIO_MIME.has(mime) ||
    /^audio\//.test(mime) ||
    mime === "application/octet-stream";
  if (!ok) {
    throw Object.assign(new Error("仅支持 webm / mp3 / wav / ogg / aac 语音格式"), { status: 400 });
  }
  if (decoded.buffer.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error(`语音文件不能超过 8MB（当前约 ${(decoded.buffer.length / (1024 * 1024)).toFixed(2)}MB）`), {
      status: 413,
    });
  }
  let contentType = mime.startsWith("audio/") ? mime : "audio/webm";
  if (contentType === "audio/mp3") contentType = "audio/mpeg";
  if (contentType === "audio/x-wav") contentType = "audio/wav";
  if (contentType === "audio/aac") contentType = "audio/mp4";
  return { ...decoded, contentType };
}

export async function deleteStorageObject(bucket, objectPath) {
  if (!bucket || !objectPath || /^https?:\/\//i.test(objectPath) || String(objectPath).startsWith("data:")) return;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${String(objectPath).replace(/^\/+/, "")}`,
    {
      method: "DELETE",
      headers: companionServiceHeaders(),
    }
  );
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(text || `删除文件失败 HTTP ${response.status}`);
  }
}

export async function uploadPrivateObject(bucket, objectPath, buffer, contentType) {
  if (bucket === "finance-receipts") {
    await ensurePrivateBucket(bucket, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  } else {
    await ensureCompanionBuckets();
  }
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: {
      ...companionServiceHeaders({
        "Content-Type": contentType || "application/octet-stream",
        "x-upsert": "true",
      }),
    },
    body: buffer,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`上传文件失败：${text || response.status}`);
  return { bucket, path: objectPath };
}

export async function createSignedUrl(bucket, objectPath, expiresIn = 300) {
  if (!bucket || !objectPath) return "";
  if (/^https?:\/\//i.test(objectPath) || String(objectPath).startsWith("data:")) return objectPath;
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: companionServiceHeaders(),
    body: JSON.stringify({ expiresIn }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.message || text || `签发 URL 失败 HTTP ${response.status}`);
  const signed = body?.signedURL || body?.signedUrl || body?.url || "";
  if (!signed) return "";
  if (/^https?:\/\//i.test(signed)) return signed;
  return `${process.env.SUPABASE_URL}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`;
}

export function buildObjectPath(userId, folder, filename) {
  const safe = String(filename || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  return `${userId}/${folder}/${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`;
}

export function maskIdentityNo(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return "";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 6)}${"*".repeat(Math.max(4, text.length - 10))}${text.slice(-4)}`;
}

export function maskBankAccount(value) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return "";
  if (text.length <= 4) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

export {
  PRIVATE_BUCKETS,
  PUBLIC_BUCKETS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ALLOWED_IMAGE_MIME,
  ALLOWED_VIDEO_MIME,
};
