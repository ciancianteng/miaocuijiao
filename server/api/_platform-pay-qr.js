/**
 * Platform collection QR for order payment page only.
 * Never expose via public /api/platform/settings or homepage.
 */
import { companionDb } from "./_companion-media-store.js";

function moneySafe(v) {
  return String(v == null ? "" : v).trim();
}

function pickChannelPayInfo(channelId, channelRow, publicMap = {}) {
  const pub = (publicMap && publicMap[channelId]) || {};
  const pubManual = pub.manual && typeof pub.manual === "object" ? pub.manual : {};
  const data = (channelRow && channelRow.data) || {};
  const manual = { ...pubManual, ...(data.manual || {}) };
  const enabled =
    pub.enabled != null
      ? !!pub.enabled
      : channelRow
        ? channelRow.enabled !== false && channelRow.visible !== false
        : !!(pub.qrUrl || pubManual.qrUrl || pub.duitnowId || pub.receiverName || pub.accountName);
  const qrUrl = moneySafe(manual.qrUrl || pub.qrUrl || data.qrUrl || "");
  const duitnowId = moneySafe(manual.duitnowId || pub.duitnowId || "");
  const receiverName = moneySafe(manual.receiverName || pub.accountName || pub.receiverName || "");
  const bankName = moneySafe(manual.bankName || pub.bankName || "");
  const bankAccount = moneySafe(manual.bankAccount || pub.bankAccount || "");
  const phone = moneySafe(manual.phone || pub.phone || "");
  const instructions = moneySafe(data.instructions || pub.instructions || "");
  if (!enabled && !qrUrl && !duitnowId && !receiverName && !bankAccount) return null;
  if (!qrUrl && !duitnowId && !receiverName && !bankAccount && !phone) return null;
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
      (qrUrl
        ? "请使用银行 App / DuitNow 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。"
        : "平台暂未配置收款二维码，请联系客服"),
  };
}

/**
 * Resolve platform pay QR for authenticated boss payment page.
 * Prefer DuitNow; fall back to bank-transfer / tng public info.
 * Never invent hardcoded OCBC / test account details.
 */
export async function loadPlatformPayQr() {
  const envQr = moneySafe(process.env.MCJ_PLATFORM_DUITNOW_QR_URL || process.env.MCJ_PLATFORM_PAY_QR_URL || "");
  let publicMap = {};
  try {
    const rows = await companionDb("platform_settings", "?id=eq.global&select=id,data&limit=1");
    const data = rows?.[0]?.data;
    if (data && typeof data === "object") {
      publicMap = data.paymentChannelsPublic && typeof data.paymentChannelsPublic === "object" ? data.paymentChannelsPublic : {};
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
    if (info && (info.qrUrl || info.duitnowId || info.receiverName || info.bankAccount)) {
      if (!info.qrUrl && envQr) info.qrUrl = envQr;
      return { ...info, source: byId[id] ? "payment_channels" : "platform_settings" };
    }
  }

  // Any enabled channel with a QR.
  for (const row of channelRows || []) {
    const id = row.channel_id || row.id;
    const info = pickChannelPayInfo(id, row, publicMap);
    if (info?.qrUrl) return { ...info, source: "payment_channels" };
  }

  if (envQr) {
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
      source: "env",
    };
  }

  return {
    channelId: "duitnow",
    title: "平台收款",
    qrUrl: "",
    duitnowId: "",
    receiverName: "",
    bankName: "",
    bankAccount: "",
    phone: "",
    accountLast4: "",
    instructions: "平台暂未配置收款二维码，请联系客服",
    source: "empty",
  };
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
