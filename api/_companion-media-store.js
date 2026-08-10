import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const PRIVATE_BUCKETS = {
  identity: "companion-identities",
  gallery: "companion-gallery",
  audio: "companion-audio",
  payment: "companion-payment-proofs",
};

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
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (!String(key || "").startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
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
    const message = body?.message || body?.error_description || body?.hint || text || `HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, body });
  }
  return body;
}

export function isMissingRelation(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /PGRST205|Could not find the table|schema cache|does not exist/i.test(text);
}

export function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  const match = raw.match(/^data:([^,]*?),(.*)$/i);
  if (!match) return null;
  const meta = String(match[1] || "");
  const payload = match[2] || "";
  const isBase64 = /;base64$/i.test(meta) || /;base64;/i.test(meta);
  if (!isBase64) return null;
  const mimeRaw = meta.replace(/;base64$/i, "").trim();
  const contentType = (mimeRaw.split(";")[0] || "application/octet-stream").trim().toLowerCase() || "application/octet-stream";
  try {
    return { contentType, buffer: Buffer.from(payload, "base64") };
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

export async function ensurePrivateBucket(bucket, mimeTypes) {
  const list = await listBuckets();
  const exists = list.some((item) => item && (item.id === bucket || item.name === bucket));
  if (exists) return bucket;
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: companionServiceHeaders(),
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: false,
      file_size_limit: 20 * 1024 * 1024,
      allowed_mime_types: mimeTypes,
    }),
  });
  const text = await response.text();
  if (!response.ok && !/already exists|duplicate/i.test(text)) {
    throw new Error(`创建私有桶 ${bucket} 失败：${text || response.status}`);
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
  await ensurePrivateBucket(PRIVATE_BUCKETS.payment, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  return PRIVATE_BUCKETS;
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

export { PRIVATE_BUCKETS };
