/**
 * Platform collection QR + boss-facing payment method list.
 * Admin payment settings (Storage + payment_channels) is the single source of truth.
 * Never expose via public /api/platform/settings or homepage.
 *
 * Rule: selected payment_method → that channel only.
 * Never cross-fallback (TNG ↛ DuitNow, Stripe ↛ DuitNow, etc.).
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
  { code: "bank-transfer", name: "银行卡", category: "manual" },
  { code: "alipay", name: "支付宝", category: "manual" },
];

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
  catfood: "猫粮余额",
  wallet: "猫粮余额",
};

const ALIAS_TO_CANONICAL = {
  manual_tng: "tng",
  touchngo: "tng",
  "touch-n-go": "tng",
  "touch_n_go": "tng",
  "touch n go": "tng",
  "touch'n go": "tng",
  tngo: "tng",
  bank: "bank-transfer",
  "bank-my": "bank-transfer",
  bank_transfer: "bank-transfer",
  banktransfer: "bank-transfer",
  "银行转账": "bank-transfer",
  "银行卡": "bank-transfer",
  "支付宝": "alipay",
  wallet: "catfood",
  "猫粮余额": "catfood",
  "猫粮": "catfood",
};

/** Drop legacy duplicate codes that must never appear as a second TNG entry. */
const DROP_ALIAS_CODES = new Set(["manual_tng", "manual_alipay"]);

export function normalizePaymentChannelId(code) {
  const raw = String(code || "").trim().toLowerCase();
  if (!raw) return "";
  if (DROP_ALIAS_CODES.has(raw)) {
    if (raw === "manual_tng") return "tng";
    return "";
  }
  if (ALIAS_TO_CANONICAL[raw]) return ALIAS_TO_CANONICAL[raw];
  if (/touch\s*'?n\s*go|touch\s*n\s*go/.test(raw)) return "tng";
  if (/cat.?food|钱包|余额/.test(raw)) return "catfood";
  return raw;
}

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

  const normalized = normalizePaymentChannelId(key);
  if (normalized === "tng") return ["tng"];
  if (normalized === "duitnow") return ["duitnow"];
  if (normalized === "alipay") return ["alipay"];
  if (normalized === "stripe") return ["stripe"];
  if (normalized === "hitpay") return ["hitpay"];
  if (normalized === "toyyibpay") return ["toyyibpay"];
  if (normalized === "bank-transfer") return ["bank-transfer", "bank-my"];
  if (normalized) return [normalized];
  return [key];
}

export function channelDisplayName(channelId, methodHint = "") {
  const id = moneySafe(channelId).toLowerCase() || normalizePaymentChannelId(methodHint);
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
  // Strict master switch: enabled must be explicitly true.
  // payment_channels row is SoT when present; public mirror cannot override a disabled row.
  // When row is missing, public mirror must also be explicitly enabled (never default-on).
  const pubEnabled =
    pub &&
    (pub.enabled === true || pub.enabled === "true" || pub.enabled === 1) &&
    pub.visible !== false &&
    pub.visible !== "false" &&
    pub.visible !== 0;
  if (channelRow) {
    const enabled =
      channelRow.enabled === true || channelRow.enabled === "true" || channelRow.enabled === 1;
    const visible =
      channelRow.visible !== false &&
      channelRow.visible !== "false" &&
      channelRow.visible !== 0;
    return !!(enabled && visible);
  }
  return !!pubEnabled;
}

/** Scope flags: default both true when unset (backward compatible). */
export function channelScopeFlags(data = {}, pub = {}) {
  const src = data && typeof data === "object" ? data : {};
  const p = pub && typeof pub === "object" ? pub : {};
  const read = (key) => {
    if (src[key] != null) return src[key] !== false;
    if (p[key] != null) return p[key] !== false;
    return true;
  };
  return {
    forOrder: read("forOrder"),
    forRecharge: read("forRecharge"),
    forDeposit: read("forDeposit"),
  };
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
  const scopes = channelScopeFlags(data, pub);
  const qrUrl = moneySafe(manual.qrUrl || data.qrUrl || pub.qrUrl || "");
  const duitnowId = moneySafe(manual.duitnowId || pub.duitnowId || "");
  const receiverName = moneySafe(manual.receiverName || pub.accountName || pub.receiverName || "");
  const bankName = moneySafe(manual.bankName || pub.bankName || "");
  const bankAccount = moneySafe(manual.bankAccount || pub.bankAccount || "");
  const phone = moneySafe(manual.phone || pub.phone || "");
  const instructions = moneySafe(data.instructions || pub.instructions || "");
  const publicLabel = moneySafe(data.publicLabel || pub.publicLabel || channelRow?.name);
  const category =
    moneySafe(channelRow?.category || data.category || "").toLowerCase() ||
    CANONICAL_PAYMENT_CHANNELS.find((c) => c.code === channelId)?.category ||
    "api";
  return {
    channelId,
    enabled,
    forOrder: scopes.forOrder,
    forRecharge: scopes.forRecharge,
    forDeposit: scopes.forDeposit,
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
  if (id === "bank-transfer" || id === "bank-my") return Boolean(meta.bankAccount && meta.receiverName) || Boolean(meta.qrUrl);
  if (id === "alipay") return Boolean(meta.qrUrl);
  return Boolean(meta.qrUrl || meta.bankAccount || meta.phone || meta.duitnowId);
}

function payInfoFromMeta(meta, hasQr) {
  return {
    channelId: meta.channelId,
    title: meta.publicLabel || channelDisplayName(meta.channelId) || "平台收款",
    qrUrl: hasQr ? meta.qrUrl : meta.qrUrl || "",
    duitnowId: meta.duitnowId,
    receiverName: meta.receiverName,
    bankName: meta.bankName,
    bankAccount: meta.bankAccount,
    phone: meta.phone,
    accountLast4: moneySafe(meta.bankAccount).slice(-4),
    minAmount: meta.minAmount,
    maxAmount: meta.maxAmount,
    instructions: meta.instructions || defaultInstructions(meta.channelId),
    enabled: true,
    unavailable: false,
    source: meta.source,
  };
}

function pickChannelPayInfo(channelId, channelRow, publicMap = {}) {
  const meta = channelMeta(channelId, channelRow, publicMap);
  if (!meta.enabled) return null;

  // Boss payment page prefers QR when present; TNG/bank may work with account fields.
  if (channelId === "duitnow" && !meta.qrUrl) return null;
  if (meta.qrUrl) return payInfoFromMeta(meta, true);
  if (channelId === "tng" && meta.phone) return payInfoFromMeta(meta, false);
  if ((channelId === "bank-transfer" || channelId === "bank-my") && meta.bankAccount) {
    return payInfoFromMeta(meta, false);
  }
  return null;
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

export async function loadPaymentChannelsContext() {
  let publicMap = {};
  let platformData = {};
  try {
    const rows = await companionDb("platform_settings", "?id=eq.global&select=id,data&limit=1");
    const data = rows?.[0]?.data;
    if (data && typeof data === "object") {
      platformData = data;
      publicMap =
        data.paymentChannelsPublic && typeof data.paymentChannelsPublic === "object"
          ? data.paymentChannelsPublic
          : {};
    }
  } catch {
    publicMap = {};
    platformData = {};
  }

  let channelRows = [];
  let tableReady = true;
  try {
    channelRows = await companionDb("payment_channels", "?select=*&order=sort.asc");
    if (!Array.isArray(channelRows)) channelRows = [];
  } catch (error) {
    // Retry without order — some rows with null sort can break PostgREST order clauses.
    try {
      channelRows = await companionDb("payment_channels", "?select=*&limit=200");
      if (!Array.isArray(channelRows)) channelRows = [];
    } catch (error2) {
      tableReady = !/PGRST205|Could not find the table|schema cache|does not exist/i.test(
        String(error2?.message || error?.message || "")
      );
      channelRows = [];
      if (tableReady) {
        console.warn(
          "[payment_channels] load failed; refusing public-mirror-only open list:",
          error2?.message || error?.message || error2 || error
        );
      }
    }
  }
  const byId = {};
  for (const r of channelRows || []) {
    const keys = [
      normalizePaymentChannelId(r.channel_id),
      normalizePaymentChannelId(r.id),
      String(r.channel_id || "").trim().toLowerCase(),
      String(r.id || "").trim().toLowerCase(),
    ].filter(Boolean);
    for (const key of keys) {
      if (!byId[key]) byId[key] = r;
    }
  }
  return { publicMap, byId, channelRows: channelRows || [], tableReady, platformData };
}

/**
 * Wallet / 猫粮余额 pay gate.
 * Enabled unless explicitly disabled in platform_settings or a catfood/wallet channel row.
 */
export function isWalletPayEnabled(platformData = {}, publicMap = {}, byId = {}) {
  const data = platformData && typeof platformData === "object" ? platformData : {};
  if (data.orderWalletPayEnabled === false || data.walletPayEnabled === false || data.balancePayEnabled === false) {
    return false;
  }
  const walletRow = byId.catfood || byId.wallet || null;
  const pub = publicMap.catfood || publicMap.wallet || null;
  if (walletRow || (pub && pub.enabled != null)) {
    return channelIsEnabled(walletRow, pub || {});
  }
  // Default: balance pay is available when not explicitly turned off.
  return true;
}

/**
 * Load pay info for ONE channel only. Never falls back to DuitNow/other channels.
 */
export async function loadChannelPayInfo(channelId) {
  const id = normalizePaymentChannelId(channelId);
  if (!id || id === "catfood") return emptyPayInfo(channelId);
  const ctx = await loadPaymentChannelsContext();
  const row = ctx.byId[id];
  const meta = channelMeta(id, row, ctx.publicMap);
  if (!meta.enabled) {
    return unavailablePayInfo(id, channelId);
  }
  const info = pickChannelPayInfo(id, row, ctx.publicMap);
  if (info && (info.qrUrl || info.phone || info.bankAccount)) {
    return { ...info, requestedMethod: moneySafe(channelId), source: meta.source };
  }
  return unavailablePayInfo(id, channelId);
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

  const { publicMap, byId } = await loadPaymentChannelsContext();

  for (const id of channelIds) {
    const info = pickChannelPayInfo(id, byId[id], publicMap);
    if (info && (info.qrUrl || info.phone || info.bankAccount)) {
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

/**
 * Admin preview helper: first enabled channel with a live QR.
 * Not used for boss order payment routing.
 */
export async function loadAdminPreviewPayQr() {
  const ctx = await loadPaymentChannelsContext();
  const adminPreviewOrder = ["duitnow", "tng", "bank-transfer", "alipay"];
  for (const id of adminPreviewOrder) {
    const info = pickChannelPayInfo(id, ctx.byId[id], ctx.publicMap);
    if (info?.qrUrl) {
      return { ...info, source: ctx.byId[id] ? "payment_channels" : "platform_settings" };
    }
  }
  for (const row of ctx.channelRows || []) {
    const id = normalizePaymentChannelId(row.channel_id || row.id);
    if (!id || adminPreviewOrder.includes(id)) continue;
    const info = pickChannelPayInfo(id, row, ctx.publicMap);
    if (info?.qrUrl) return { ...info, source: "payment_channels" };
  }
  return emptyPayInfo();
}

/**
 * Build boss-visible method list from payment_channels (SoT).
 * methodRows (payment_methods) only supply API credentials — never invent duplicate TNG.
 * Does NOT include catfood; callers append when wallet pay is enabled.
 */
export async function listBossPaymentMethods(methodRows = []) {
  const ctx = await loadPaymentChannelsContext();
  const methodsByCode = {};
  for (const row of methodRows || []) {
    const code = normalizePaymentChannelId(row.code || row.name);
    if (!code || code === "catfood" || DROP_ALIAS_CODES.has(String(row.code || "").toLowerCase())) continue;
    if (!methodsByCode[code]) methodsByCode[code] = row;
  }

  const seen = new Set();
  const list = [];

  const pushChannel = (code, name, category, channelRow, methodRow) => {
    if (!code || code === "catfood" || seen.has(code)) return;
    seen.add(code);
    const meta = channelMeta(code, channelRow || ctx.byId[code], ctx.publicMap);
    const enabled = meta.enabled;
    const isManual =
      (meta.category || category) === "manual" ||
      ["duitnow", "tng", "bank-transfer", "alipay"].includes(code);
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
      CHANNEL_LABELS[code] ||
      CANONICAL_PAYMENT_CHANNELS.find((c) => c.code === code)?.name ||
      code;
    const open = !!(enabled && configured);
    const payInfo = open && isManual ? payInfoFromMeta(meta, Boolean(meta.qrUrl)) : null;
    list.push({
      id: methodRow?.id || channelRow?.id || "",
      code,
      name: label,
      category: isManual ? "manual" : "api",
      enabled,
      configured,
      open,
      forOrder: meta.forOrder !== false,
      forRecharge: meta.forRecharge !== false,
      forDeposit: meta.forDeposit !== false,
      mode: channelRow?.mode || methodRow?.mode || "test",
      statusText: open ? "可用" : "暂未开放",
      payInfo: payInfo && payInfo.enabled ? payInfo : null,
      api_base_url: methodRow?.api_base_url || "",
      merchant_id: methodRow?.merchant_id || "",
      api_key: methodRow?.api_key || "",
      api_secret: methodRow?.api_secret || "",
      callback_secret: methodRow?.callback_secret || "",
      redirect_url: methodRow?.redirect_url || "",
      callback_url: methodRow?.callback_url || "",
      is_enabled: open,
      sort_order: Number(channelRow?.sort ?? methodRow?.sort_order ?? 100),
      _meta: meta,
    });
  };

  for (const tpl of CANONICAL_PAYMENT_CHANNELS) {
    pushChannel(tpl.code, tpl.name, tpl.category, ctx.byId[tpl.code], methodsByCode[tpl.code]);
  }
  for (const row of ctx.channelRows) {
    const code = normalizePaymentChannelId(row.channel_id || row.id);
    if (!code || seen.has(code)) continue;
    pushChannel(code, row.name, row.category, row, methodsByCode[code]);
  }
  // Also surface channels that only exist in the public mirror (table missing / partial).
  // NEVER invent an open channel from public mirror when payment_channels table is ready
  // but the row is simply disabled/missing — disabled rows already handled via byId.
  for (const rawId of Object.keys(ctx.publicMap || {})) {
    const code = normalizePaymentChannelId(rawId);
    if (!code || seen.has(code) || code === "catfood") continue;
    // If table is ready and this channel has no row, only show when public explicitly enabled.
    // If table is ready and row exists, it was already pushed above.
    if (ctx.tableReady && ctx.channelRows.length && !ctx.byId[code]) {
      const pub = ctx.publicMap[code] || ctx.publicMap[rawId] || {};
      if (!(pub.enabled === true || pub.enabled === "true" || pub.enabled === 1)) continue;
    }
    pushChannel(code, CHANNEL_LABELS[code] || code, "manual", ctx.byId[code], methodsByCode[code]);
  }

  list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const walletPayEnabled = isWalletPayEnabled(ctx.platformData, ctx.publicMap, ctx.byId);
  return {
    tableReady: ctx.tableReady || Boolean(ctx.channelRows.length) || Boolean(Object.keys(ctx.publicMap || {}).length),
    methods: list,
    walletPayEnabled,
    context: ctx,
  };
}

/** Boss order-pay methods: open + forOrder channels + optional 猫粮余额. */
export async function listBossOrderPaymentMethods(methodRows = []) {
  const listed = await listBossPaymentMethods(methodRows);
  const openChannels = listed.methods.filter((m) => m.open && m.forOrder !== false);
  const methods = openChannels.map((m) => ({
    id: m.code,
    code: m.code,
    label: m.name,
    name: m.name,
    open: true,
    enabled: true,
    configured: true,
    forOrder: true,
    forRecharge: m.forRecharge !== false,
    statusText: "可用",
    category: m.category,
    payInfo: m.payInfo,
  }));
  if (listed.walletPayEnabled) {
    methods.push({
      id: "catfood",
      code: "catfood",
      label: "猫粮余额",
      name: "猫粮余额",
      open: true,
      enabled: true,
      configured: true,
      forOrder: true,
      forRecharge: false,
      statusText: "可用",
      category: "wallet",
      payInfo: null,
    });
  }
  return {
    tableReady: listed.tableReady,
    methods,
    walletPayEnabled: listed.walletPayEnabled,
    allChannels: listed.methods,
  };
}

/** Boss recharge methods: open + forRecharge (no catfood — recharge tops up wallet). */
export function filterBossRechargeMethods(methods = []) {
  return (methods || []).filter((m) => m && m.open && m.forRecharge !== false && m.code !== "catfood");
}

/**
 * Companion RM100 deposit pay channels: enabled + forDeposit + usable manual payInfo.
 * Never includes catfood / API-gateway-only methods without payee details.
 */
export async function listDepositPaymentMethods(methodRows = []) {
  const listed = await listBossPaymentMethods(methodRows);
  const methods = (listed.methods || [])
    .filter(
      (m) =>
        m &&
        m.open &&
        m.forDeposit !== false &&
        m.code !== "catfood" &&
        m.payInfo &&
        (m.payInfo.qrUrl || m.payInfo.bankAccount || m.payInfo.duitnowId || m.payInfo.phone)
    )
    .map((m) => ({
      id: m.code,
      code: m.code,
      label: m.name,
      name: m.name,
      open: true,
      enabled: true,
      forDeposit: true,
      category: m.category || "manual",
      statusText: "可用",
      payInfo: {
        channelId: m.payInfo.channelId || m.code,
        title: m.payInfo.title || m.name,
        qrUrl: m.payInfo.qrUrl || "",
        duitnowId: m.payInfo.duitnowId || "",
        receiverName: m.payInfo.receiverName || "",
        bankName: m.payInfo.bankName || "",
        bankAccount: m.payInfo.bankAccount || "",
        phone: m.payInfo.phone || "",
        instructions: m.payInfo.instructions || "",
        amountRm: 100,
      },
    }));
  return { tableReady: listed.tableReady, methods, amountRm: 100 };
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
