/**
 * companion_profiles.commission_rate = 平台抽成 %（与后台表单一致）.
 * Legacy rows sometimes stored companion share (70–90); treat those as share.
 */
export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Math.round(money(value) * 100) / 100;
}

/** @returns {{ platformRate: number, companionShareRate: number }} */
export function resolvePlatformCommission(storedRate, fallbackPlatform = 20) {
  const raw = money(storedRate);
  let platformRate;
  if (!(raw > 0 && raw <= 100)) {
    platformRate = money(fallbackPlatform) || 20;
  } else if (raw >= 50) {
    // Legacy companion-share values (e.g. 80) → platform 20
    platformRate = roundMoney(100 - raw);
  } else {
    platformRate = raw;
  }
  platformRate = Math.min(100, Math.max(0, platformRate));
  return {
    platformRate,
    companionShareRate: roundMoney(100 - platformRate),
  };
}
