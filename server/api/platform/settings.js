/**
 * Public platform settings (read-only).
 * Used by homepage / companion apply / login gates.
 * Never includes secrets.
 */
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

const DEFAULT_SETTINGS = {
  siteName: "妙脆角",
  siteNameEn: "Meow Cui Jiao",
  companyName: "MEOW CUI JIAO ENTERPRISE",
  contactEmail: "",
  supportContact: "",
  timezone: "Asia/Kuala_Lumpur",
  defaultCurrency: "RM",
  catFoodDisplayName: "猫粮",
  maintenanceMessage: "",
  termsUrl: "",
  privacyUrl: "",
  registerOpen: true,
  allowBossOrder: true,
  allowCompanionApply: true,
  allowCustomerServiceLogin: true,
  allowCompanionGrab: true,
  allowWithdraw: true,
  allowRecharge: true,
  maintenanceMode: false,
  showAnnouncements: true,
  gameplayMallOpen: true,
  defaultCommissionRate: 20,
  defaultRebateRate: 0,
  defaultDeposit: 100,
  defaultLevel: "Lv1",
  sessionHours: 168,
};

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key] || (key === "SUPABASE_URL" && process.env.VITE_SUPABASE_URL));
}
function url() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function publicView(data = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...data,
    // strip any accidental secret-like keys
    smtpPass: undefined,
    aiApiKey: undefined,
    serviceRoleKey: undefined,
  };
  // Never publish platform收款二维码 / 账户到首页或公开 settings。
  delete merged.paymentChannelsPublic;
  delete merged.paymentBankAccounts;
  delete merged.payment_bank_accounts;
  delete merged.banks;
  delete merged.qrUrl;
  delete merged.duitnowId;
  delete merged.accountNumber;
  delete merged.bankAccount;
  return merged;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!hasDb()) {
    return json(res, 200, { ok: true, configured: false, settings: DEFAULT_SETTINGS, message: "数据库未配置" });
  }
  try {
    const response = await fetch(`${url()}/rest/v1/platform_settings?id=eq.global&limit=1`, {
      headers: serviceHeaders(),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      if (/PGRST205|Could not find the table/i.test(String(text))) {
        return json(res, 200, {
          ok: true,
          configured: false,
          settings: DEFAULT_SETTINGS,
          message: "缺少 platform_settings 表",
        });
      }
      throw new Error(body?.message || text || `HTTP ${response.status}`);
    }
    const row = Array.isArray(body) ? body[0] : null;
    return json(res, 200, {
      ok: true,
      configured: true,
      settings: publicView((row && row.data) || {}),
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "读取系统设置失败", settings: DEFAULT_SETTINGS });
  }
}
