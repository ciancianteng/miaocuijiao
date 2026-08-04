/**
 * Platform mail sender for MVP.
 * Primary: Resend HTTP API
 * Fallback: SMTP (nodemailer) when configured
 * SMS: stub only — reserved for a later international SMS release (not used in MVP).
 */

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function mailFrom() {
  return env("RESEND_FROM") || env("SMTP_FROM") || env("MAIL_FROM") || "MEOW CUI JIAO <onboarding@resend.dev>";
}

function hasResend() {
  return !!env("RESEND_API_KEY");
}

function hasSmtp() {
  return !!(env("SMTP_HOST") && (env("SMTP_USER") || env("SMTP_PASS") || env("SMTP_PORT")));
}

export function mailProviderStatus() {
  return {
    resend: hasResend(),
    smtp: hasSmtp(),
    from: mailFrom(),
    smsEnabled: false,
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

async function sendViaResend({ to, subject, text, html }) {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) throw Object.assign(new Error("未配置 RESEND_API_KEY"), { status: 503, code: "NO_RESEND" });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [String(to).trim()],
      subject: String(subject || "妙脆角通知"),
      text: String(text || ""),
      html: html || undefined,
    }),
  });
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.error?.message || raw || "Resend 发送失败"), {
      status: response.status || 502,
      code: "RESEND_FAIL",
      body,
    });
  }
  return { ok: true, provider: "resend", id: body.id || "", to };
}

async function sendViaSmtp({ to, subject, text, html }) {
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
    from: mailFrom(),
    to: String(to).trim(),
    subject: String(subject || "妙脆角通知"),
    text: String(text || ""),
    html: html || undefined,
  });
  return { ok: true, provider: "smtp", id: info?.messageId || "", to };
}

/**
 * Send a transactional email. Prefers Resend, then SMTP.
 */
export async function sendMail({ to, subject, text, html, purpose } = {}) {
  const email = String(to || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error("收件邮箱无效"), { status: 400, code: "BAD_EMAIL" });
  }
  if (hasResend()) {
    try {
      return await sendViaResend({ to: email, subject, text, html });
    } catch (err) {
      if (!hasSmtp()) throw err;
      // Fall through to SMTP if Resend fails and SMTP exists.
    }
  }
  if (hasSmtp()) return sendViaSmtp({ to: email, subject, text, html });
  throw Object.assign(new Error("邮件服务未配置（需要 RESEND_API_KEY 或 SMTP_*）"), {
    status: 503,
    code: "NO_MAIL",
    purpose: purpose || "",
  });
}

export async function sendEmailOtp({ to, code, purpose = "otp", roleLabel = "" } = {}) {
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
    `有效期 15 分钟。如非本人操作请忽略本邮件。\n\n` +
    `MEOW CUI JIAO`;
  const html =
    `<div style="font-family:Segoe UI,PingFang SC,sans-serif;line-height:1.6;color:#221018">` +
    `<p style="font-size:16px;margin:0 0 12px">${title}</p>` +
    `<p style="margin:0 0 8px">你的验证码是：</p>` +
    `<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:0 0 16px;color:#d9488a">${code}</p>` +
    `<p style="margin:0;color:#666;font-size:13px">有效期 15 分钟。如非本人操作请忽略本邮件。</p>` +
    `</div>`;
  return sendMail({ to, subject: title, text, html, purpose });
}

export default {
  sendMail,
  sendEmailOtp,
  sendSmsOtp,
  mailProviderStatus,
};
