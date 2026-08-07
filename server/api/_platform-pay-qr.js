/**
 * Platform collection QR for order payment page only.
 * Never expose via public /api/platform/settings or homepage.
 * Admin payment settings (Storage + payment_channels) is the single source of truth.
 */
import { companionDb } from "./_companion-media-store.js";

function moneySafe(v) {
  return String(v == null ? "" : v).trim();
}

const EMPTY_INSTRUCTIONS = "支付通道暂不可用";

function channelIsEnabled(channelRow, pub = {}) {
  // Prefer DB channel row as SoT; public mirror is secondary.
  if (channelRow) {
    return channelRow.enabled !== false && channelRow.visible !== false;
  }
  if (pub && pub.enabled != null) return !!pub.enabled;
  return false;
}

function pickChannelPayInfo(channelId, channelRow, publicMap = {}) {
  const pub = (publicMap && publicMap[channelId]) || {};
  const pubManual = pub.manual && typeof pub.manual === "object" ? pub.manual : {};
  const data = (channelRow && channelRow.data) || {};
  const manual = { ...pubManual, ...(data.manual || {}) };
  const enabled = channelIsEnabled(channelRow, pub);
  const qrUrl = moneySafe(manual.qrUrl || data.qrUrl || pub.qrUrl || "");
  const duitnowId = moneySafe(manual.duitnowId || pub.duitnowId || "");
  const receiverName = moneySafe(manual.receiverName || pub.accountName || pub.receiverName || "");
  const bankName = moneySafe(manual.bankName || pub.bankName || "");
  const bankAccount = moneySafe(manual.bankAccount || pub.bankAccount || "");
  const phone = moneySafe(manual.phone || pub.phone || "");
  const instructions = moneySafe(data.instructions || pub.instructions || "");

  // Boss payment page requires an enabled channel WITH a live QR image.
  if (!enabled || !qrUrl) return null;

  const publicLabel = moneySafe(data.publicLabel || pub.publicLabel || channelRow?.name);
  return {
    channelId,
    title: publicLabel || (channelId === "duitnow" ? "DuitNow 收款" : "平台收款二维码"),
    qrUrl,
    duitnowId,
    receiverName,
    bankName,
    bankAccount,
    phone,
    accountLast4: moneySafe(pub.accountLast4 || bankAccount).slice(-4),
    minAmount: data.minAmount != null ? data.minAmount : pub.minAmount,
    maxAmount: data.maxAmount != null ? data.maxAmount : pub.maxAmount,
    instructions:
      instructions ||
      "请使用银行 App / DuitNow 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。",
    enabled: true,
  };
}

function emptyPayInfo() {
  return {
    channelId: "",
    title: "平台收款",
    qrUrl: "",
    duitnowId: "",
    receiverName: "",
    bankName: "",
    bankAccount: "",
    phone: "",
    accountLast4: "",
    instructions: EMPTY_INSTRUCTIONS,
    enabled: false,
    source: "empty",
  };
}

/**
 * Resolve platform pay QR for authenticated boss payment page.
 * Prefer DuitNow; fall back to bank-transfer / tng with an enabled QR.
 * Never invent hardcoded accounts or fall back to static/env images by default.
 */
export async function loadPlatformPayQr() {
  let publicMap = {};
  try {
    const rows = await companionDb("platform_settings", "?id=eq.global&select=id,data&limit=1");
    const data = rows?.[0]?.data;
    if (data && typeof data === "object") {
      publicMap =
        data.paymentChannelsPublic && typeof data.paymentChannelsPublic === "object"
          ? data.paymentChannelsPublic
          : {};
    }
  } catch {
    publicMap = {};
  }

  let channelRows = [];
  try {
    channelRows = await companionDb("payment_channels", "?select=*&order=sort.asc");
  } catch {
    channelRows = [];
  }
  const byId = (channelRows || []).reduce((m, r) => {
    m[r.channel_id || r.id] = r;
    return m;
  }, {});

  const prefer = ["duitnow", "bank-transfer", "bank-my", "tng"];
  for (const id of prefer) {
    const info = pickChannelPayInfo(id, byId[id], publicMap);
    if (info && info.qrUrl) {
      return { ...info, source: byId[id] ? "payment_channels" : "platform_settings" };
    }
  }

  // Any other enabled channel with a QR.
  for (const row of channelRows || []) {
    const id = row.channel_id || row.id;
    if (prefer.includes(String(id))) continue;
    const info = pickChannelPayInfo(id, row, publicMap);
    if (info?.qrUrl) return { ...info, source: "payment_channels" };
  }

  // Explicit opt-in only — never silently serve a stale env QR in production acceptance.
  const allowEnv = String(process.env.MCJ_ALLOW_ENV_PAY_QR || "").trim() === "1";
  const envQr = moneySafe(process.env.MCJ_PLATFORM_DUITNOW_QR_URL || process.env.MCJ_PLATFORM_PAY_QR_URL || "");
  if (allowEnv && envQr) {
    return {
      channelId: "duitnow",
      title: "平台收款二维码",
      qrUrl: envQr,
      duitnowId: "",
      receiverName: "",
      bankName: "",
      bankAccount: "",
      phone: "",
      accountLast4: "",
      instructions: "请扫描下方收款二维码完成付款，付款后上传截图并点击「我已付款」。",
      enabled: true,
      source: "env",
    };
  }

  return emptyPayInfo();
}

/** Keys that must never appear on public platform settings responses. */
export const PUBLIC_SETTINGS_PAYMENT_STRIP_KEYS = [
  "paymentChannelsPublic",
  "paymentBankAccounts",
  "payment_bank_accounts",
  "banks",
  "qrUrl",
  "duitnowId",
  "accountNumber",
  "bankAccount",
];
