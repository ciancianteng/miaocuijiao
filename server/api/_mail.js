import { logOtpEvent } from "./_otp-identity.js";
/**
 * Platform mail sender for MVP.
 * Primary: Resend HTTP API
 * Fallback: SMTP (nodemailer) when configured
 * SMS: stub only — reserved for a later international SMS release (not used in MVP).
 *
 * Env (Vercel Preview + Production):
 * - RESEND_API_KEY
 * - RESEND_FROM        bare email or `Name <email@domain>` (orders / general)
 * - RESEND_OTP_FROM    preferred OTP From — keep OTP off orders@ for inbox placement
 */

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null) return String(fallback || "").trim();
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

function formatFrom(raw, displayName = "MEOW CUI JIAO") {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/<[^>]+@[^>]+>/.test(value)) return value;
  if (/^\S+@\S+\.\S+$/.test(value)) return `${displayName} <${value}>`;
  return value;
}

/** Normalize From header: accept bare email or RFC display-name form. */
function mailFrom(override = "") {
  const raw =
    String(override || "").trim() ||
    env("RESEND_FROM") ||
    env("SMTP_FROM") ||
    env("MAIL_FROM") ||
    "onboarding@resend.dev";
  return formatFrom(raw) || raw;
}

/**
 * OTP should not share the orders mailbox. Prefer RESEND_OTP_FROM, then a
 * noreply@ on the same domain as RESEND_FROM, then RESEND_FROM.
 */
export function otpMailFrom() {
  const explicit = env("RESEND_OTP_FROM") || env("MAIL_OTP_FROM");
  if (explicit) return formatFrom(explicit, "MEOW CUI JIAO");
  const general = env("RESEND_FROM") || env("SMTP_FROM") || env("MAIL_FROM");
  const bare = String(general).match(/<?([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>?/);
  if (bare?.[1]) {
    const domain = bare[1].split("@")[1];
    const local = bare[1].split("@")[0].toLowerCase();
    if (domain && local !== "noreply" && local !== "auth" && local !== "otp") {
      return formatFrom(`noreply@${domain}`, "MEOW CUI JIAO");
    }
  }
  return mailFrom();
}

function hasResend() {
  return env("RESEND_API_KEY").length > 0;
}

function hasSmtp() {
  return !!(env("SMTP_HOST") && (env("SMTP_USER") || env("SMTP_PASS") || env("SMTP_PORT")));
}

export function mailProviderStatus() {
  const key = env("RESEND_API_KEY");
  return {
    resend: hasResend(),
    resendKeyLen: key ? key.length : 0,
    resendKeyPrefix: key ? `${key.slice(0, 3)}…` : "",
    smtp: hasSmtp(),
    from: mailFrom(),
    otpFrom: otpMailFrom(),
    vercelEnv: String(process.env.VERCEL_ENV || ""),
    smsEnabled: false,
  };
}

/** Safe for API clients — never expose provider keys, env names, or deploy labels. */
export function publicMailHint() {
  const otpFrom = otpMailFrom();
  const domainMatch = String(otpFrom).match(/@([\w.-]+\.[A-Za-z]{2,})/);
  return {
    configured: hasResend() || hasSmtp(),
    otpFromDomain: domainMatch ? domainMatch[1].toLowerCase() : "",
  };
}

/** Reserved for later SMS OTP — MVP always returns disabled. */
export async function sendSmsOtp({ phone, code, purpose } = {}) {
  return {
    ok: false,
    channel: "sms",
    skipped: true,
    reason: "sms_disabled_mvp",
    message: "MVP 第一版不发送短信验证码，请使用邮箱。",
    phone: phone || "",
    purpose: purpose || "otp",
    // Keep the code out of response; callers own OTP storage.
    codeIgnored: !!code,
  };
}

function maskEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  const name = value.slice(0, at);
  const domain = value.slice(at + 1);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}***@${domain}`;
}

async function sendViaResend({ to, subject, text, html, from: fromOverride, purpose = "", requestId = "" } = {}) {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) throw Object.assign(new Error("未配置 RESEND_API_KEY"), { status: 503, code: "NO_RESEND" });
  const from = mailFrom(fromOverride);
  const payload = {
    from,
    to: [String(to).trim()],
    subject: String(subject || "妙脆角通知"),
    text: String(text || ""),
    html: html || undefined,
  };
  if (purpose || requestId) {
    payload.tags = [];
    if (purpose) payload.tags.push({ name: "purpose", value: String(purpose).slice(0, 40) });
    if (requestId) payload.tags.push({ name: "request_id", value: String(requestId).slice(0, 64) });
  }
  const started = Date.now();
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[mail/resend] network error", {
      requestId: requestId || undefined,
      purpose: purpose || undefined,
      toMasked: maskEmail(to),
      error: err?.message || String(err),
      latencyMs: Date.now() - started,
    });
    throw Object.assign(new Error(`Resend 网络错误：${err?.message || err}`), {
      status: 502,
      code: "RESEND_NETWORK",
    });
  }
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  if (!response.ok) {
    const detail =
      body?.message ||
      body?.error?.message ||
      (typeof body?.error === "string" ? body.error : "") ||
      raw ||
      "Resend 发送失败";
    console.error("[mail/resend] fail", {
      requestId: requestId || undefined,
      purpose: purpose || undefined,
      status: response.status,
      detail: String(detail).slice(0, 300),
      from,
      toMasked: maskEmail(payload.to[0]),
      latencyMs: Date.now() - started,
    });
    if (String(purpose || "").startsWith("otp")) {
      logOtpEvent("otp_provider_failed", {
        ok: false,
        requestId: requestId || "",
        purpose,
        provider: "resend",
        providerStatus: response.status,
        error: String(detail).slice(0, 240),
        emailMasked: maskEmail(payload.to[0]),
        latencyMs: Date.now() - started,
      });
    }
    throw Object.assign(new Error(detail), {
      status: response.status || 502,
      code: "RESEND_FAIL",
      body,
    });
  }
  console.info("[mail/resend] sent", {
    requestId: requestId || undefined,
    purpose: purpose || undefined,
    id: body.id || "",
    toMasked: maskEmail(payload.to[0]),
    from,
    latencyMs: Date.now() - started,
  });
  if (String(purpose || "").startsWith("otp")) {
    logOtpEvent("otp_provider_success", {
      ok: true,
      requestId: requestId || "",
      purpose,
      provider: "resend",
      providerStatus: response.status,
      providerMessageId: body.id || "",
      emailMasked: maskEmail(payload.to[0]),
      latencyMs: Date.now() - started,
    });
  }
  return { ok: true, provider: "resend", id: body.id || "", to, requestId: requestId || "" };
}

async function sendViaSmtp({ to, subject, text, html, from: fromOverride } = {}) {
  if (!hasSmtp()) throw Object.assign(new Error("未配置 SMTP"), { status: 503, code: "NO_SMTP" });
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(env("SMTP_PORT") || 587) || 587;
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    auth: env("SMTP_USER") ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined,
  });
  const info = await transporter.sendMail({
    from: mailFrom(fromOverride),
    to: String(to).trim(),
    subject: String(subject || "妙脆角通知"),
    text: String(text || ""),
    html: html || undefined,
  });
  return { ok: true, provider: "smtp", id: info?.messageId || "", to };
}

/**
 * Send a transactional email. Prefers Resend, then SMTP.
 * Optional `from` overrides RESEND_FROM for transactional order mail.
 */
export async function sendMail({ to, subject, text, html, purpose, from, requestId } = {}) {
  const email = String(to || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error("收件邮箱无效"), { status: 400, code: "BAD_EMAIL" });
  }
  if (hasResend()) {
    try {
      return await sendViaResend({ to: email, subject, text, html, from, purpose, requestId });
    } catch (err) {
      console.error("[mail] Resend failed", {
        smtpConfigured: hasSmtp(),
        purpose: purpose || "",
        requestId: requestId || undefined,
        toMasked: maskEmail(email),
        error: err?.message || String(err),
      });
      if (!hasSmtp()) throw err;
      // Fall through to SMTP if Resend fails and SMTP exists.
    }
  }
  if (hasSmtp()) return sendViaSmtp({ to: email, subject, text, html, from });
  console.error("[mail] no provider", {
    purpose: purpose || "",
    requestId: requestId || undefined,
    status: mailProviderStatus(),
  });
  throw Object.assign(new Error("邮件服务未配置（需要 RESEND_API_KEY 或 SMTP_*）"), {
    status: 503,
    code: "NO_MAIL",
    purpose: purpose || "",
  });
}

export async function sendEmailOtp({ to, code, purpose = "otp", roleLabel = "", requestId = "" } = {}) {
  const purposeText =
    purpose === "login"
      ? "登录验证码"
      : purpose === "reset" || purpose === "forgot"
        ? "找回密码验证码"
        : purpose === "register"
          ? "注册验证码"
          : "验证码";
  const title = roleLabel ? `妙脆角${roleLabel} · ${purposeText}` : `妙脆角 · ${purposeText}`;
  const text =
    `你的验证码是：${code}\n\n` +
    `有效期 10 分钟，使用一次后立即失效。如非本人操作请忽略本邮件。\n\n` +
    `MEOW CUI JIAO`;
  const html =
    `<div style="font-family:Segoe UI,PingFang SC,sans-serif;line-height:1.6;color:#221018">` +
    `<p style="font-size:16px;margin:0 0 12px">${title}</p>` +
    `<p style="margin:0 0 8px">你的验证码是：</p>` +
    `<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:0 0 16px;color:#d9488a">${code}</p>` +
    `<p style="margin:0;color:#666;font-size:13px">有效期 10 分钟，使用一次后立即失效。如非本人操作请忽略本邮件。</p>` +
    `</div>`;
  return sendMail({
    to,
    subject: title,
    text,
    html,
    purpose: `otp_${purpose}`,
    from: otpMailFrom(),
    requestId,
  });
}

export default {
  sendMail,
  sendEmailOtp,
  sendSmsOtp,
  mailProviderStatus,
  publicMailHint,
  otpMailFrom,
};
