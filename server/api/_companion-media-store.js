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
      [
        body?.error_description,
        body?.msg,
        body?.message,
        body?.error,
        body?.hint,
        body?.details,
        body?.code ? `code=${body.code}` : "",
        typeof body === "string" ? body.slice(0, 240) : "",
      ]
        .filter(Boolean)[0] || `Supabase 请求失败 (HTTP ${response.status}; ${table}${query ? "?" + String(query).slice(0, 80) : ""})`;
    throw Object.assign(new Error(message), { status: response.status, body, table });
  }
  return body;
}

export function isMissingRelation(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /PGRST205|Could not find the table|schema cache|does not exist/i.test(text);
}

export function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
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
    40 * 1024 * 1024
  );
  await ensurePrivateBucket(PRIVATE_BUCKETS.payment, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  try {
    await ensurePublicBucket(PUBLIC_BUCKETS.profile, ["image/jpeg", "image/png", "image/webp"]);
  } catch {
    /* public bucket optional; private + signed URL still works */
  }
  return PRIVATE_BUCKETS;
}

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "application/octet-stream",
]);

export function assertVideoUpload(decoded) {
  if (!decoded || !decoded.buffer) {
    throw Object.assign(new Error("文件格式无效，请选择 mp4 / mov 视频"), { status: 400 });
  }
  const mime = String(decoded.contentType || "").toLowerCase() || "video/mp4";
  const ok = ALLOWED_VIDEO_MIME.has(mime) || /^video\//.test(mime);
  if (!ok) {
    throw Object.assign(new Error("仅支持 mp4 / mov / webm 视频"), { status: 400 });
  }
  if (decoded.buffer.length > MAX_VIDEO_BYTES) {
    throw Object.assign(new Error("视频不能超过 40MB"), { status: 413 });
  }
  return {
    ...decoded,
    contentType: mime.startsWith("video/") ? mime : "video/mp4",
  };
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
  const mime = String(decoded.contentType || "").toLowerCase() || "audio/webm";
  const ok =
    ALLOWED_AUDIO_MIME.has(mime) ||
    /^audio\//.test(mime) ||
    mime === "application/octet-stream";
  if (!ok) {
    throw Object.assign(new Error("仅支持 webm / mp3 / wav / ogg / aac 语音格式"), { status: 400 });
  }
  if (decoded.buffer.length > MAX_AUDIO_BYTES) {
    throw Object.assign(new Error("语音文件不能超过 8MB"), { status: 413 });
  }
  return { ...decoded, contentType: mime.startsWith("audio/") ? mime : "audio/webm" };
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

export { PRIVATE_BUCKETS, PUBLIC_BUCKETS, MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIME };
