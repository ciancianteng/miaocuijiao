/**
 * Shared OTP identity helpers.
 * Login/register/forgot OTP is email-channel in MVP; phone normalize is shared
 * for profile/register payloads so every entry uses one Malaysia-aware ruleset.
 */

export function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function isValidEmail(raw) {
  const email = normalizeEmail(raw);
  return !!(email && /^\S+@\S+\.\S+$/.test(email));
}

export function maskEmail(raw) {
  const email = normalizeEmail(raw);
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}***@${domain}`;
}

/**
 * Malaysia-first E.164 normalizer.
 * Accepts: 0123456789 | 60123456789 | +60123456789 | 12-345 6789 (with dial).
 * Returns { ok, e164, national, country, input } or { ok:false, error }.
 */
export function normalizePhoneNumber(raw, { defaultCountry = "MY" } = {}) {
  const input = String(raw || "").trim();
  if (!input) return { ok: false, error: "empty", input };

  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;

  const country = String(defaultCountry || "MY").toUpperCase();
  const dialByCountry = { MY: "60", SG: "65", CN: "86", TW: "886", HK: "852", ID: "62", TH: "66", VN: "84" };
  const dial = dialByCountry[country] || "60";

  let national = "";
  if (digits.startsWith("+")) {
    const all = digits.slice(1).replace(/\D/g, "");
    if (all.startsWith(dial)) national = all.slice(dial.length);
    else return { ok: false, error: "unsupported_country", input };
  } else {
    const all = digits.replace(/\D/g, "");
    if (all.startsWith(dial)) national = all.slice(dial.length);
    else if (all.startsWith("0")) national = all.replace(/^0+/, "");
    else national = all;
  }

  national = national.replace(/\D/g, "");
  if (country === "MY") {
    // MY mobiles are typically 9–10 national digits after removing leading 0.
    if (national.length < 8 || national.length > 11) {
      return { ok: false, error: "invalid_length", input, national };
    }
  } else if (national.length < 6 || national.length > 12) {
    return { ok: false, error: "invalid_length", input, national };
  }

  const e164 = `+${dial}${national}`;
  return { ok: true, e164, national, country, dial: `+${dial}`, input };
}

export function maskPhone(e164OrRaw) {
  const s = String(e164OrRaw || "").replace(/\s+/g, "");
  if (!s) return "***";
  if (s.length <= 4) return "***";
  return `${s.slice(0, Math.min(4, s.length - 2))}***${s.slice(-2)}`;
}

export function newOtpRequestId() {
  return `otp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Structured OTP logs. Never log plaintext OTP / API secrets / tokens.
 * event examples: otp_request | otp_provider_request | otp_provider_success |
 * otp_provider_failed | otp_rate_limited | otp_verify_success | otp_verify_failed |
 * otp_suppressed (anti-enumeration / not found)
 */
export function logOtpEvent(event, fields = {}) {
  const safe = {
    event: String(event || "otp_event"),
    ts: new Date().toISOString(),
    ...fields,
  };
  delete safe.code;
  delete safe.otp;
  delete safe.password;
  delete safe.token;
  delete safe.accessToken;
  delete safe.refreshToken;
  delete safe.apiKey;
  delete safe.authorization;
  if (typeof safe.error === "string") safe.error = safe.error.slice(0, 240);
  if (safe.ok === false || /fail|error|limited|denied/i.test(safe.event)) {
    console.error("[otp]", safe);
  } else {
    console.info("[otp]", safe);
  }
}
