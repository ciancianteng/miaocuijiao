/**
 * Platform "calendar day" helpers.
 * Canonical business timezone for homepage + admin daily KPIs.
 */
export const PLATFORM_STATS_TIMEZONE = "Asia/Kuala_Lumpur";

export function localDateYmd(date = new Date(), timeZone = PLATFORM_STATS_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function shiftLocalYmd(ymd, days) {
  const parts = String(ymd || "").split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return "";
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive YYYY-MM-DD window in the platform timezone. `all` returns null. */
export function resolveStatsRange(preset, { now = new Date(), from = "", to = "", timeZone = PLATFORM_STATS_TIMEZONE } = {}) {
  const key = String(preset || "all").trim();
  const today = localDateYmd(now, timeZone);
  if (!key || key === "all") return null;
  if (key === "today") return { preset: key, from: today, to: today };
  if (key === "yesterday") {
    const y = shiftLocalYmd(today, -1);
    return { preset: key, from: y, to: y };
  }
  if (key === "7d") return { preset: key, from: shiftLocalYmd(today, -6), to: today };
  if (key === "30d") return { preset: key, from: shiftLocalYmd(today, -29), to: today };
  if (key === "month") return { preset: key, from: today.slice(0, 8) + "01", to: today };
  if (key === "last_month") {
    const [y, m] = today.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 2, 1));
    const end = new Date(Date.UTC(y, m - 1, 0));
    const fmt = (d) => d.toISOString().slice(0, 10);
    return { preset: key, from: fmt(start), to: fmt(end) };
  }
  if (key === "custom") {
    const a = String(from || "").slice(0, 10);
    const b = String(to || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
      throw Object.assign(new Error("请选择开始和结束日期"), { status: 400 });
    }
    return a <= b ? { preset: key, from: a, to: b } : { preset: key, from: b, to: a };
  }
  throw Object.assign(new Error("未知统计范围"), { status: 400 });
}

export function localYmdInRange(iso, range, timeZone = PLATFORM_STATS_TIMEZONE) {
  if (!range) return true;
  if (!iso) return false;
  const ymd = localDateYmd(iso, timeZone);
  if (!ymd) return false;
  return ymd >= range.from && ymd <= range.to;
}

/** True when `iso` falls on the same local calendar day as `localYmd` (YYYY-MM-DD). */
export function isCreatedOnLocalDay(iso, localYmd, timeZone = PLATFORM_STATS_TIMEZONE) {
  if (!iso || !localYmd) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return localDateYmd(d, timeZone) === String(localYmd);
}
