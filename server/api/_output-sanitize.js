/**
 * Response-only sanitizer for Boss / Customer Service / Admin APIs.
 * Internal [[MARKERS]] in orders.note / orders.description and payment-proof storage
 * locations must never reach clients. Business logic keeps reading raw rows; only
 * serialized output passes through here.
 */
import { stripInternalMarkers } from "./_order-assignment.js";

const STORAGE_KEYS = new Set(["storage_path", "storage_bucket", "storagePath", "storageBucket"]);
// Supabase signed object URLs embed bucket/path by design and are the only way proofs render.
const SIGNED_URL_RE = /^https?:\/\/\S+\/storage\/v1\/object\/sign\/\S+[?&]token=\S+$/i;
const STORAGE_HINT_RE = /bucket=|payment-proofs/i;
const BARE_PROOF_PATH_RE = /^\/?[\w.-]*\/?(?:[\w.-]+\/)*payment-proofs\/\S*$/i;

export function isSignedStorageUrl(value) {
  return typeof value === "string" && SIGNED_URL_RE.test(value.trim());
}

export function sanitizeOrderText(text) {
  if (text == null) return "";
  let out = String(text);
  if (!out) return out;
  if (out.includes("[[")) out = stripInternalMarkers(out);
  if (STORAGE_HINT_RE.test(out)) {
    out = out
      .split(/\r?\n/)
      .filter((line) => !STORAGE_HINT_RE.test(line))
      .join("\n")
      .trim();
  }
  return out;
}

function scrubString(value) {
  if (!value.includes("[[") && !STORAGE_HINT_RE.test(value)) return value;
  if (isSignedStorageUrl(value)) return value;
  if (BARE_PROOF_PATH_RE.test(value.trim())) return "";
  return sanitizeOrderText(value);
}

export function scrubInternalOutput(value, depth = 0) {
  if (depth > 40) return value;
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => scrubInternalOutput(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date || (typeof Buffer !== "undefined" && Buffer.isBuffer(value))) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (STORAGE_KEYS.has(key)) continue;
    out[key] = scrubInternalOutput(item, depth + 1);
  }
  return out;
}
