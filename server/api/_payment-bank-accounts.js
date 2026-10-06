/**
 * Admin「收款渠道」(payment_bank_accounts) → private QR image + boss recharge methods.
 * Images live in a private bucket; only the object path is stored and every read is re-signed.
 */
import crypto from "node:crypto";
import {
  assertImageUpload,
  companionDb,
  companionServiceHeaders,
  createSignedUrl,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
} from "./_companion-media-store.js";

export const BANK_QR_BUCKET = "payment-channel-images";
export const BANK_QR_PREFIX = "bank-accounts/";
export const BANK_METHOD_PREFIX = "acct-";
const QR_MIME = ["image/jpeg", "image/png", "image/webp"];
const SIGN_TTL_SECONDS = 60 * 60 * 12;

function encryptionKeyMaterial() {
  return (
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.PLATFORM_SECRETS_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

/** Same AES-256-GCM format as admin/payment-settings.js encryptPayload. */
export function decryptBankPayload(blob) {
  if (!blob) return {};
  const material = encryptionKeyMaterial();
  if (!material) return {};
  const [ivB64, tagB64, dataB64] = String(blob).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return {};
  try {
    const key = crypto.createHash("sha256").update(String(material)).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(plain);
  } catch {
    return {};
  }
}

export function isBankQrPath(path) {
  const p = String(path || "").trim();
  return p.startsWith(BANK_QR_PREFIX) && !p.includes("..") && /\.(jpe?g|png|webp)$/i.test(p);
}

function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return "";
  if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

export async function uploadBankQrImage(dataUrl, bankId = "") {
  const decoded = assertImageUpload(decodeDataUrl(dataUrl));
  const mime = sniffImageMime(decoded.buffer);
  if (!mime) {
    throw Object.assign(new Error("图片内容无效或已损坏，仅支持真实的 JPG / JPEG / PNG / WEBP 图片"), { status: 400 });
  }
  decoded.contentType = mime;
  await ensurePrivateBucket(BANK_QR_BUCKET, QR_MIME, 10 * 1024 * 1024);
  const ext = mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
  const folder =
    String(bankId || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "draft";
  const objectPath = `${BANK_QR_PREFIX}${folder}/qr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await uploadPrivateObject(BANK_QR_BUCKET, objectPath, decoded.buffer, decoded.contentType);
  const url = await signBankQr(objectPath);
  return { bucket: BANK_QR_BUCKET, path: objectPath, url };
}

export async function signBankQr(path) {
  if (!isBankQrPath(path)) return "";
  try {
    return (await createSignedUrl(BANK_QR_BUCKET, path, SIGN_TTL_SECONDS)) || "";
  } catch {
    return "";
  }
}

/** Storage rejects a body-less DELETE sent with Content-Type: application/json, so use the bulk remove API. */
export async function removeBankQr(path) {
  if (!isBankQrPath(path)) return false;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BANK_QR_BUCKET}`, {
      method: "DELETE",
      headers: companionServiceHeaders(),
      body: JSON.stringify({ prefixes: [path] }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return true;
  } catch (err) {
    console.warn("[bank-qr] storage cleanup failed", path, err.message || err);
    return false;
  }
}

export function bankQrPathOf(row = {}) {
  return String(row.qr_image_path || row.qrImagePath || "").trim();
}

export function isRechargeUsage(usage) {
  const u = String(usage || "").trim();
  return !u || /充值|recharge|全部|通用|all/i.test(u);
}

/** Default usage「充值收款」also collects order payments; only an explicit「仅充值」opts out. */
export function isOrderUsage(usage) {
  const u = String(usage || "").trim();
  if (/仅充值|只充值|recharge\s*only/i.test(u)) return false;
  return isRechargeUsage(u) || /下单|订单|order/i.test(u);
}

export function bankMethodCode(id) {
  return `${BANK_METHOD_PREFIX}${String(id || "").trim().toLowerCase()}`;
}

export function bankIdFromMethodCode(code) {
  const c = String(code || "").trim().toLowerCase();
  return c.startsWith(BANK_METHOD_PREFIX) ? c.slice(BANK_METHOD_PREFIX.length) : "";
}

function bankLabel(row = {}) {
  const provider = String(row.bank_name || "").trim() || "收款渠道";
  const holder = String(row.account_name || "").trim();
  return holder ? `${provider} · ${holder}` : provider;
}

export async function bankPayInfo(row = {}) {
  const payload = decryptBankPayload(row.encrypted_payload);
  const account = String(payload.accountNumber || "").trim() || String(row.account_number_mask || "").trim();
  const qrUrl = await signBankQr(bankQrPathOf(row));
  return {
    channelId: bankMethodCode(row.id),
    title: bankLabel(row),
    channelName: String(row.bank_name || "").trim(),
    qrUrl,
    duitnowId: "",
    receiverName: String(row.account_name || "").trim(),
    enterpriseName: String(row.enterprise_name || "").trim(),
    bankName: String(row.bank_name || "").trim(),
    bankAccount: account,
    phone: "",
    accountLast4: account.replace(/\s+/g, "").slice(-4),
    currency: String(row.currency || "MYR").trim() || "MYR",
    instructions: String(row.instructions || "").trim() || "请按以下收款信息完成付款，付款后上传截图并点击「我已付款」。",
    enabled: true,
    unavailable: false,
    source: "payment_bank_accounts",
  };
}

async function loadBankRows() {
  try {
    const rows = await companionDb("payment_bank_accounts", "?enabled=eq.true&order=is_default.desc,updated_at.desc&limit=50");
    if (Array.isArray(rows)) return rows;
  } catch {
    /* table missing → fall back to platform_settings mirror */
  }
  try {
    const rows = await companionDb("platform_settings", "?id=eq.global&select=data&limit=1");
    const list = rows?.[0]?.data?.paymentBankAccounts;
    return Array.isArray(list) ? list.filter((b) => b && b.enabled !== false) : [];
  } catch {
    return [];
  }
}

/** Enabled recharge-usage bank/e-wallet channels in the same shape as listBossPaymentMethods rows. */
export async function listBossBankAccountMethods() {
  return listBankAccountMethods((row) => isRechargeUsage(row.usage));
}

/** Enabled order-usage bank/e-wallet channels (boss order pay / gift pay). */
export async function listBossOrderBankAccountMethods() {
  return listBankAccountMethods((row) => isOrderUsage(row.usage));
}

async function listBankAccountMethods(keep) {
  const rows = (await loadBankRows()).filter((row) => row && row.id && keep(row));
  const out = [];
  for (const row of rows) {
    const payInfo = await bankPayInfo(row);
    const usable = Boolean(payInfo.bankAccount || payInfo.qrUrl);
    out.push({
      id: String(row.id),
      code: bankMethodCode(row.id),
      name: payInfo.title,
      category: "manual",
      enabled: true,
      configured: usable,
      open: usable,
      forOrder: isOrderUsage(row.usage),
      forRecharge: isRechargeUsage(row.usage),
      forDeposit: false,
      mode: "live",
      statusText: usable ? "可用" : "暂未开放",
      payInfo: usable ? payInfo : null,
      is_enabled: usable,
      sort_order: row.is_default ? 0 : 50,
    });
  }
  return out;
}

/** code → "收款渠道 · Maybank · 张三" for admin review lists (includes disabled rows). */
export async function bankMethodLabels(codes = []) {
  const wanted = new Set(codes.map((c) => bankIdFromMethodCode(c)).filter(Boolean));
  if (!wanted.size) return {};
  let rows = [];
  try {
    rows = await companionDb("payment_bank_accounts", "?select=id,bank_name,account_name&limit=200");
  } catch {
    rows = [];
  }
  const out = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row.id || "").toLowerCase();
    if (wanted.has(id)) out[bankMethodCode(id)] = `收款渠道 · ${bankLabel(row)}`;
  }
  return out;
}

export async function loadBankAccountPayInfo(code) {
  const id = bankIdFromMethodCode(code);
  if (!id) return null;
  const rows = await loadBankRows();
  const row = rows.find((r) => String(r.id || "").toLowerCase() === id);
  if (!row || !(isRechargeUsage(row.usage) || isOrderUsage(row.usage))) return null;
  const info = await bankPayInfo(row);
  return info.bankAccount || info.qrUrl ? info : null;
}
