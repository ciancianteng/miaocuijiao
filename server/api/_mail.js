/**
 * Platform mail sender for MVP.
 * Primary: Resend HTTP API
 * Fallback: SMTP (nodemailer) when configured
 * SMS: stub only — reserved for a later international SMS release (not used in MVP).
 *
 * Env (Vercel Preview + Production):
 * - RESEND_API_KEY
 * - RESEND_FROM  (bare email or `Name <email@domain>`)
 */

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null) return String(fallback || "").trim();
  return String(raw).trim().replace(/^['"]|['"]$/g, "");
}

/** Normalize From header: accept bare email or RFC display-name form. */
function mailFrom(override = "") {
  const raw =
    String(override || "").trim() ||
    env("RESEND_FROM") ||
    env("SMTP_FROM") ||
    env("MAIL_FROM") ||
    "onboarding@resend.dev";
  if (/<[^>]+@[^>]+>/.test(raw)) return raw;
  if (/^\S+@\S+\.\S+$/.test(raw)) return `MEOW CUI JIAO <${raw}>`;
  return raw;
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
    vercelEnv: String(process.env.VERCEL_ENV || ""),
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

async function sendViaResend({ to, subject, text, html, from: fromOverride } = {}) {
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
    console.error("[mail/resend] network error", err?.message || err);
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
    const detail = body?.message || body?.error?.message || (typeof body?.error === "string" ? body.error : "") || raw || "Resend 发送失败";
    console.error("[mail/resend] fail", response.status, detail, { from, to: payload.to });
    throw Object.assign(new Error(detail), {
      status: response.status || 502,
      code: "RESEND_FAIL",
      body,
    });
  }
  console.info("[mail/resend] sent", { id: body.id || "", to: payload.to[0], from });
  return { ok: true, provider: "resend", id: body.id || "", to };
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
export async function sendMail({ to, subject, text, html, purpose, from } = {}) {
  const email = String(to || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error("收件邮箱无效"), { status: 400, code: "BAD_EMAIL" });
  }
  if (hasResend()) {
    try {
      return await sendViaResend({ to: email, subject, text, html, from });
    } catch (err) {
      console.error("[mail] Resend failed, smtp=", hasSmtp(), "purpose=", purpose || "", err?.message || err);
      if (!hasSmtp()) throw err;
      // Fall through to SMTP if Resend fails and SMTP exists.
    }
  }
  if (hasSmtp()) return sendViaSmtp({ to: email, subject, text, html, from });
  console.error("[mail] no provider", mailProviderStatus(), "purpose=", purpose || "");
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
    `有效期 10 分钟，使用一次后立即失效。如非本人操作请忽略本邮件。\n\n` +
    `MEOW CUI JIAO`;
  const html =
    `<div style="font-family:Segoe UI,PingFang SC,sans-serif;line-height:1.6;color:#221018">` +
    `<p style="font-size:16px;margin:0 0 12px">${title}</p>` +
    `<p style="margin:0 0 8px">你的验证码是：</p>` +
    `<p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:0 0 16px;color:#d9488a">${code}</p>` +
    `<p style="margin:0;color:#666;font-size:13px">有效期 10 分钟，使用一次后立即失效。如非本人操作请忽略本邮件。</p>` +
    `</div>`;
  return sendMail({ to, subject: title, text, html, purpose });
}

export default {
  sendMail,
  sendEmailOtp,
  sendSmsOtp,
  mailProviderStatus,
};
