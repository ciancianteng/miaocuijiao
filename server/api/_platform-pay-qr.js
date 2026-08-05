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
  const data = (channelRow && channelRow.data) || {};
  const manual = data.manual || pub.manual || {};
  const enabled =
    pub.enabled != null
      ? !!pub.enabled
      : channelRow
        ? channelRow.enabled !== false && channelRow.visible !== false
        : !!pub.qrUrl || !!pub.duitnowId;
  if (!enabled && !moneySafe(pub.qrUrl || manual.qrUrl || data.qrUrl)) return null;
  const qrUrl = moneySafe(manual.qrUrl || pub.qrUrl || data.qrUrl || "");
  const duitnowId = moneySafe(manual.duitnowId || pub.duitnowId || "");
  const receiverName = moneySafe(manual.receiverName || pub.accountName || pub.receiverName || "");
  const bankName = moneySafe(manual.bankName || pub.bankName || "");
  const instructions = moneySafe(data.instructions || pub.instructions || "");
  if (!qrUrl && !duitnowId && !receiverName) return null;
  return {
    channelId,
    title:
      moneySafe(data.publicLabel || pub.publicLabel || channelRow?.name) ||
      (channelId === "duitnow" ? "OCBC OneCollect DuitNow QR" : "平台收款二维码"),
    qrUrl,
    duitnowId,
    receiverName,
    bankName,
    accountLast4: moneySafe(pub.accountLast4 || "").slice(-4),
    instructions:
      instructions ||
      "请使用银行 App / DuitNow 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。",
  };
}

/**
 * Resolve platform pay QR for authenticated boss payment page.
 * Prefer DuitNow / OCBC OneCollect; fall back to bank-transfer / bank-my public info.
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
    if (info && (info.qrUrl || info.duitnowId)) {
      if (!info.qrUrl && envQr) info.qrUrl = envQr;
      if (id === "duitnow" || /ocbc|duitnow|onecollect/i.test(`${info.title} ${info.bankName}`)) {
        info.title = "OCBC OneCollect DuitNow QR";
      }
      return { ...info, source: "platform_settings" };
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
      title: "OCBC OneCollect DuitNow QR",
      qrUrl: envQr,
      duitnowId: "",
      receiverName: "",
      bankName: "OCBC",
      accountLast4: "",
      instructions: "请扫描下方 OCBC OneCollect DuitNow 二维码完成付款，付款后上传截图并点击「我已付款」。",
      source: "env",
    };
  }

  return {
    channelId: "duitnow",
    title: "OCBC OneCollect DuitNow QR",
    qrUrl: "",
    duitnowId: "",
    receiverName: "",
    bankName: "OCBC",
    accountLast4: "",
    instructions: "收款二维码尚未配置。请联系客服确认付款方式，或稍后再试。",
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
