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

/** True when `iso` falls on the same local calendar day as `localYmd` (YYYY-MM-DD). */
export function isCreatedOnLocalDay(iso, localYmd, timeZone = PLATFORM_STATS_TIMEZONE) {
  if (!iso || !localYmd) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return localDateYmd(d, timeZone) === String(localYmd);
}
