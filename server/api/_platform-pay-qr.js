/**
 * Boss-facing payment channel / QR helpers.
 * Admin payment_channels (+ public mirror) is the single source of truth.
 * Never expose via public /api/platform/settings or homepage.
 */
import { companionDb } from "./_companion-media-store.js";

function moneySafe(v) {
  return String(v == null ? "" : v).trim();
}

const EMPTY_INSTRUCTIONS = "支付通道暂不可用";

/** Canonical channel codes shown on boss recharge / order pay. */
export const CANONICAL_PAYMENT_CHANNELS = [
  { code: "hitpay", name: "HitPay", category: "api" },
  { code: "toyyibpay", name: "ToyyibPay", category: "api" },
  { code: "stripe", name: "Stripe", category: "api" },
  { code: "duitnow", name: "DuitNow", category: "manual" },
  { code: "tng", name: "TNG", category: "manual" },
  { code: "bank-transfer", name: "银行转账", category: "manual" },
];

const ALIAS_TO_CANONICAL = {
  manual_tng: "tng",
  touchngo: "tng",
  "touch-n-go": "tng",
  "touch_n_go": "tng",
  "touch n go": "tng",
  "touch'n go": "tng",
  "touch ’n go": "tng",
  "touch n go / 人工确认": "tng",
  tngo: "tng",
  bank: "bank-transfer",
  "bank-my": "bank-transfer",
  bank_transfer: "bank-transfer",
  banktransfer: "bank-transfer",
  "银行转账": "bank-transfer",
  "银行卡": "bank-transfer",
};

/** Drop legacy duplicate codes that must never appear as a second TNG entry. */
const DROP_ALIAS_CODES = new Set(["manual_tng", "alipay", "manual_alipay"]);

export function normalizePaymentChannelId(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (!raw) return "";
  if (DROP_ALIAS_CODES.has(raw) && raw !== "manual_tng") return "";
  if (raw === "manual_tng") return "tng";
  if (ALIAS_TO_CANONICAL[raw]) return ALIAS_TO_CANONICAL[raw];
  // Fuzzy: names containing touch / tng duplicates
  if (/touch\s*n\s*go|人工确认/.test(raw) && /tng|touch/.test(raw)) return "tng";
  return raw;
}

function channelIsEnabled(channelRow, pub = {}) {
  if (channelRow) {
    return channelRow.enabled !== false && channelRow.visible !== false;
  }
  if (pub && pub.enabled != null) return !!pub.enabled;
  return false;
}

function mergeManual(channelRow, pub = {}) {
  const pubManual = pub.manual && typeof pub.manual === "object" ? pub.manual : {};
  const data = (channelRow && channelRow.data) || {};
  return { ...pubManual, ...(data.manual || {}) };
}

function channelMeta(channelId, channelRow, publicMap = {}) {
  const pub = (publicMap && publicMap[channelId]) || {};
  const data = (channelRow && channelRow.data) || {};
  const manual = mergeManual(channelRow, pub);
  const enabled = channelIsEnabled(channelRow, pub);
  const qrUrl = moneySafe(manual.qrUrl || data.qrUrl || pub.qrUrl || "");
  const duitnowId = moneySafe(manual.duitnowId || pub.duitnowId || "");
  const receiverName = moneySafe(manual.receiverName || pub.accountName || pub.receiverName || "");
  const bankName = moneySafe(manual.bankName || pub.bankName || "");
  const bankAccount = moneySafe(manual.bankAccount || pub.bankAccount || "");
  const phone = moneySafe(manual.phone || pub.phone || "");
  const instructions = moneySafe(data.instructions || pub.instructions || "");
  const publicLabel = moneySafe(data.publicLabel || pub.publicLabel || channelRow?.name);
  const category = moneySafe(channelRow?.category || data.category || "").toLowerCase() ||
    (CANONICAL_PAYMENT_CHANNELS.find((c) => c.code === channelId)?.category || "api");
  return {
    channelId,
    enabled,
    category,
    publicLabel,
    qrUrl,
    duitnowId,
    receiverName,
    bankName,
    bankAccount,
    phone,
    instructions,
    minAmount: data.minAmount != null ? data.minAmount : pub.minAmount,
    maxAmount: data.maxAmount != null ? data.maxAmount : pub.maxAmount,
    source: channelRow ? "payment_channels" : pub.qrUrl || pub.enabled != null ? "platform_settings" : "empty",
  };
}

function manualUsable(meta) {
  if (!meta?.enabled) return false;
  const id = meta.channelId;
  if (id === "duitnow") return Boolean(meta.qrUrl);
  if (id === "tng") return Boolean(meta.phone || meta.qrUrl);
  if (id === "bank-transfer") return Boolean(meta.bankAccount && meta.receiverName);
  // Other manual: need some收款 tip
  return Boolean(meta.qrUrl || meta.bankAccount || meta.phone || meta.duitnowId);
}

function pickChannelPayInfo(channelId, channelRow, publicMap = {}) {
  const meta = channelMeta(channelId, channelRow, publicMap);
  // Boss payment page requires an enabled channel WITH a live QR image for QR flows.
  // DuitNow always needs QR. TNG/bank may show without QR if other fields exist — but
  // pay panel still prefers QR when present.
  if (!meta.enabled) return null;
  if (channelId === "duitnow" && !meta.qrUrl) return null;
  if (!meta.qrUrl && channelId === "duitnow") return null;
  // For QR panel: require qrUrl for channels that are QR-first
  if (!meta.qrUrl && (channelId === "duitnow" || channelId === "bank-transfer" || channelId === "tng")) {
    // Allow TNG/bank without QR only if they have account fields (pay panel shows meta).
    if (channelId === "tng" && meta.phone) {
      return payInfoFromMeta(meta, false);
    }
    if (channelId === "bank-transfer" && meta.bankAccount) {
      return payInfoFromMeta(meta, false);
    }
    return null;
  }
  if (!meta.qrUrl) return null;
  return payInfoFromMeta(meta, true);
}

function payInfoFromMeta(meta, hasQr) {
  return {
    channelId: meta.channelId,
    title:
      meta.publicLabel ||
      (meta.channelId === "duitnow" ? "DuitNow" : meta.channelId === "tng" ? "TNG" : meta.channelId === "bank-transfer" ? "银行转账" : "平台收款"),
    qrUrl: hasQr ? meta.qrUrl : meta.qrUrl || "",
    duitnowId: meta.duitnowId,
    receiverName: meta.receiverName,
    bankName: meta.bankName,
    bankAccount: meta.bankAccount,
    phone: meta.phone,
    accountLast4: moneySafe(meta.bankAccount).slice(-4),
    minAmount: meta.minAmount,
    maxAmount: meta.maxAmount,
    instructions:
      meta.instructions ||
      (meta.channelId === "duitnow"
        ? "请使用银行 App / DuitNow 扫描下方二维码完成付款，付款后上传截图并点击「我已付款」。"
        : "请按收款信息完成付款，付款后上传截图并提交审核。"),
    enabled: true,
    source: meta.source,
  };
}

function emptyPayInfo(channelId = "") {
  return {
    channelId: channelId || "",
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

export async function loadPaymentChannelsContext() {
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
  let tableReady = true;
  try {
    channelRows = await companionDb("payment_channels", "?select=*&order=sort.asc");
  } catch (err) {
    tableReady = false;
    channelRows = [];
  }
  const byId = (channelRows || []).reduce((m, r) => {
    const id = normalizePaymentChannelId(r.channel_id || r.id) || r.channel_id || r.id;
    if (id) m[id] = r;
    return m;
  }, {});
  return { publicMap, byId, channelRows: channelRows || [], tableReady };
}

/**
 * Load pay info for ONE channel only. Never falls back to DuitNow/other channels.
 */
export async function loadChannelPayInfo(channelId) {
  const id = normalizePaymentChannelId(channelId);
  if (!id) return emptyPayInfo();
  const ctx = await loadPaymentChannelsContext();
  const row = ctx.byId[id];
  const pub = ctx.publicMap[id] || {};
  const meta = channelMeta(id, row, ctx.publicMap);
  if (!meta.enabled) {
    return { ...emptyPayInfo(id), title: meta.publicLabel || row?.name || id, source: meta.source };
  }
  const info = pickChannelPayInfo(id, row, ctx.publicMap);
  if (info) return info;
  // Enabled but missing QR/收款: still return labeled empty (no fallback channel).
  if (manualUsable(meta) && (meta.phone || meta.bankAccount || meta.duitnowId)) {
    return payInfoFromMeta(meta, Boolean(meta.qrUrl));
  }
  return {
    ...emptyPayInfo(id),
    title: meta.publicLabel || row?.name || id,
    receiverName: meta.receiverName,
    bankName: meta.bankName,
    bankAccount: meta.bankAccount,
    phone: meta.phone,
    duitnowId: meta.duitnowId,
    source: meta.source || (pub ? "platform_settings" : "empty"),
  };
}

/**
 * Legacy helper for admin "当前生效二维码" preview.
 * Prefer enabled DuitNow; do not invent QRs. Used by admin payment settings only.
 */
export async function loadPlatformPayQr() {
  const ctx = await loadPaymentChannelsContext();
  const prefer = ["duitnow", "bank-transfer", "tng"];
  for (const id of prefer) {
    const info = pickChannelPayInfo(id, ctx.byId[id], ctx.publicMap);
    if (info && info.qrUrl) {
      return { ...info, source: ctx.byId[id] ? "payment_channels" : "platform_settings" };
    }
  }
  for (const row of ctx.channelRows || []) {
    const id = normalizePaymentChannelId(row.channel_id || row.id);
    if (!id || prefer.includes(id)) continue;
    const info = pickChannelPayInfo(id, row, ctx.publicMap);
    if (info?.qrUrl) return { ...info, source: "payment_channels" };
  }
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

/**
 * Build boss-visible method list from payment_channels (SoT).
 * methodRows (payment_methods) only supply API credentials — never invent duplicate TNG.
 */
export async function listBossPaymentMethods(methodRows = []) {
  const ctx = await loadPaymentChannelsContext();
  const methodsByCode = {};
  for (const row of methodRows || []) {
    const code = normalizePaymentChannelId(row.code || row.name);
    if (!code || DROP_ALIAS_CODES.has(String(row.code || "").toLowerCase())) continue;
    // Prefer first canonical row; skip alias rows entirely
    if (!methodsByCode[code]) methodsByCode[code] = row;
  }

  const seen = new Set();
  const list = [];

  const pushChannel = (code, name, category, channelRow, methodRow) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    const meta = channelMeta(code, channelRow || ctx.byId[code], ctx.publicMap);
    const enabled = meta.enabled;
    const isManual = (meta.category || category) === "manual" || ["duitnow", "tng", "bank-transfer"].includes(code);
    let configured = false;
    if (enabled) {
      if (isManual) configured = manualUsable(meta);
      else {
        const hasKey = Boolean(
          String(methodRow?.api_key || "").trim() || String(methodRow?.api_secret || "").trim()
        );
        configured = hasKey;
      }
    }
    const label =
      meta.publicLabel ||
      channelRow?.name ||
      name ||
      CANONICAL_PAYMENT_CHANNELS.find((c) => c.code === code)?.name ||
      code;
    const payInfo =
      configured && isManual
        ? payInfoFromMeta(meta, Boolean(meta.qrUrl))
        : null;
    list.push({
      id: methodRow?.id || channelRow?.id || "",
      code,
      name: label,
      category: isManual ? "manual" : "api",
      enabled,
      configured,
      mode: channelRow?.mode || methodRow?.mode || meta.mode || "test",
      statusText: !enabled || !configured ? "暂未开放" : "可用",
      payInfo: payInfo && payInfo.enabled ? payInfo : null,
      // raw fields for recharge provider calls
      api_base_url: methodRow?.api_base_url || "",
      merchant_id: methodRow?.merchant_id || "",
      api_key: methodRow?.api_key || "",
      api_secret: methodRow?.api_secret || "",
      callback_secret: methodRow?.callback_secret || "",
      redirect_url: methodRow?.redirect_url || "",
      callback_url: methodRow?.callback_url || "",
      is_enabled: enabled && configured,
      sort_order: Number(channelRow?.sort ?? methodRow?.sort_order ?? 100),
      _meta: meta,
    });
  };

  // Prefer channels present in payment_channels / public map / templates
  for (const tpl of CANONICAL_PAYMENT_CHANNELS) {
    pushChannel(tpl.code, tpl.name, tpl.category, ctx.byId[tpl.code], methodsByCode[tpl.code]);
  }
  // Any other non-alias channel rows
  for (const row of ctx.channelRows) {
    const code = normalizePaymentChannelId(row.channel_id || row.id);
    if (!code || seen.has(code)) continue;
    pushChannel(code, row.name, row.category, row, methodsByCode[code]);
  }

  list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return { tableReady: ctx.tableReady || Boolean(ctx.channelRows.length), methods: list, context: ctx };
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
