/**
 * Platform collection QR for order payment page only.
 * Never expose via public /api/platform/settings or homepage.
 * Admin payment settings (Storage + payment_channels) is the single source of truth.
 *
 * Rule: selected payment_method → that channel only.
 * Never cross-fallback (TNG ↛ DuitNow, Stripe ↛ DuitNow, etc.).
 */
import { companionDb } from "./_companion-media-store.js";

function moneySafe(v) {
  return String(v == null ? "" : v).trim();
}

const EMPTY_INSTRUCTIONS = "支付通道暂不可用";

const CHANNEL_LABELS = {
  tng: "TNG",
  duitnow: "DuitNow",
  "bank-transfer": "银行卡",
  "bank-my": "银行卡",
  bank: "银行卡",
  alipay: "支付宝",
  stripe: "Stripe",
  hitpay: "HitPay",
  toyyibpay: "ToyyibPay",
};

/**
 * Map boss-facing payment_method / labels to payment_channels ids.
 * Returns an ordered list of aliases for the SAME logical channel only
 * (e.g. bank → bank-transfer / bank-my). Never mixes TNG with DuitNow.
 */
export function resolvePayChannelIds(method) {
  const raw = moneySafe(method);
  const key = raw.toLowerCase();
  if (!key) return [];
  if (/cat.?food|wallet|猫粮|余额/.test(key)) return [];

  if (/^(tng|touch\s*'?n\s*go)$/i.test(key) || key === "tng" || /^tng\b/.test(key)) {
    return ["tng"];
  }
  if (/duitnow/.test(key)) return ["duitnow"];
  if (/alipay|支付宝/.test(key)) return ["alipay"];
  if (/stripe/.test(key)) return ["stripe"];
  if (/hitpay/.test(key)) return ["hitpay"];
  if (/toyyib/.test(key)) return ["toyyibpay"];
  if (/bank-transfer|bank-my|bank|银行|card|银行卡|manual_transfer|线下/.test(key)) {
    return ["bank-transfer", "bank-my"];
  }
  // Passthrough exact channel ids / unknown codes — still no cross-channel fallback.
  return [key];
}

export function channelDisplayName(channelId, methodHint = "") {
  const id = moneySafe(channelId).toLowerCase();
  if (CHANNEL_LABELS[id]) return CHANNEL_LABELS[id];
  const fromMethod = resolvePayChannelIds(methodHint)[0];
  if (fromMethod && CHANNEL_LABELS[fromMethod]) return CHANNEL_LABELS[fromMethod];
  const hint = moneySafe(methodHint);
  if (hint) return hint;
  return "该支付方式";
}

function unavailablePayInfo(channelId, methodHint = "") {
  const id = moneySafe(channelId) || resolvePayChannelIds(methodHint)[0] || "";
  const label = channelDisplayName(id, methodHint);
  return {
    channelId: id,
    requestedMethod: moneySafe(methodHint),
    title: label,
    qrUrl: "",
    duitnowId: "",
    receiverName: "",
    bankName: "",
    bankAccount: "",
    phone: "",
    accountLast4: "",
    instructions: `${label} 暂未开放，请选择其他支付方式`,
    enabled: false,
    unavailable: true,
    source: "unavailable",
  };
}

function channelIsEnabled(channelRow, pub = {}) {
  // Prefer DB channel row as SoT; public mirror is secondary.
  if (channelRow) {
    return channelRow.enabled !== false && channelRow.visible !== false;
  }
  if (pub && pub.enabled != null) return !!pub.enabled;
  return false;
}

function defaultInstructions(channelId) {
  if (channelId === "tng") {
    return "请使用 Touch 'n Go 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。";
  }
  if (channelId === "duitnow") {
    return "请使用银行 App / DuitNow 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。";
  }
  if (channelId === "alipay") {
    return "请使用支付宝扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。";
  }
  if (channelId === "bank-transfer" || channelId === "bank-my") {
    return "请按下方收款信息完成银行转账，付款后上传截图并点击「我已付款」。";
  }
  return "请扫描下方收款二维码完成付款，付款后上传截图并点击「我已付款」。";
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
    title: publicLabel || channelDisplayName(channelId) || "平台收款二维码",
    qrUrl,
    duitnowId,
    receiverName,
    bankName,
    bankAccount,
    phone,
    accountLast4: moneySafe(pub.accountLast4 || bankAccount).slice(-4),
    minAmount: data.minAmount != null ? data.minAmount : pub.minAmount,
    maxAmount: data.maxAmount != null ? data.maxAmount : pub.maxAmount,
    instructions: instructions || defaultInstructions(channelId),
    enabled: true,
    unavailable: false,
  };
}

function emptyPayInfo(methodHint = "") {
  if (moneySafe(methodHint)) return unavailablePayInfo("", methodHint);
  return {
    channelId: "",
    requestedMethod: "",
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
    unavailable: true,
    source: "empty",
  };
}

async function loadChannelMaps() {
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
  return { publicMap, channelRows: channelRows || [], byId };
}

/**
 * Resolve platform pay QR for authenticated boss payment page.
 * @param {string} [preferredMethod] order.payment_method / paymentMethod — required for correct routing.
 * Never invent hardcoded accounts. Never substitute another channel's QR.
 */
export async function loadPlatformPayQr(preferredMethod = "") {
  const method = moneySafe(preferredMethod);
  const channelIds = resolvePayChannelIds(method);

  // No method / wallet → no QR (caller should skip wallet orders anyway).
  if (!channelIds.length) {
    return emptyPayInfo(method);
  }

  const { publicMap, byId } = await loadChannelMaps();

  for (const id of channelIds) {
    const info = pickChannelPayInfo(id, byId[id], publicMap);
    if (info && info.qrUrl) {
      return {
        ...info,
        requestedMethod: method,
        source: byId[id] ? "payment_channels" : "platform_settings",
      };
    }
  }

  // Env QR only when the requested channel itself is DuitNow (still no cross-channel swap).
  const primaryId = channelIds[0];
  if (primaryId === "duitnow") {
    const allowEnv = String(process.env.MCJ_ALLOW_ENV_PAY_QR || "").trim() === "1";
    const envQr = moneySafe(process.env.MCJ_PLATFORM_DUITNOW_QR_URL || process.env.MCJ_PLATFORM_PAY_QR_URL || "");
    if (allowEnv && envQr) {
      return {
        channelId: "duitnow",
        requestedMethod: method,
        title: "DuitNow 收款",
        qrUrl: envQr,
        duitnowId: "",
        receiverName: "",
        bankName: "",
        bankAccount: "",
        phone: "",
        accountLast4: "",
        instructions: defaultInstructions("duitnow"),
        enabled: true,
        unavailable: false,
        source: "env",
      };
    }
  }

  return unavailablePayInfo(primaryId, method);
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
