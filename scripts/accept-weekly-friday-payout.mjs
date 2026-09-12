/**
 * Quick unit checks for weekly settlement date + smoke API paths.
 * Usage: node scripts/accept-weekly-friday-payout.mjs
 */
import {
  computeSettlementDate,
  DEFAULT_WEEKLY_SETTINGS,
  zonedParts,
} from "../server/api/_weekly-settlement.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function atKL(y, m, d, h = 12, min = 0) {
  // Construct a Date that corresponds to KL local wall time via offset trick
  const utc = Date.UTC(y, m - 1, d, h - 8, min, 0);
  return new Date(utc);
}

const cfg = DEFAULT_WEEKLY_SETTINGS;

// Case 1: Monday → this Friday
{
  const mon = atKL(2026, 8, 3, 10, 0); // 2026-08-03 is Monday
  const parts = zonedParts(mon);
  assert(parts.weekday === 1, "mon weekday");
  const sd = computeSettlementDate(mon, cfg);
  assert(sd === "2026-08-07", `Mon expect 2026-08-07 got ${sd}`);
}

// Case 2: Thursday 22:00 → this Friday
{
  const thu = atKL(2026, 8, 6, 22, 0);
  const sd = computeSettlementDate(thu, cfg);
  assert(sd === "2026-08-07", `Thu22 expect 2026-08-07 got ${sd}`);
}

// Case 3: Friday morning (after Thu 23:59) → next Friday
{
  const fri = atKL(2026, 8, 7, 10, 0);
  const sd = computeSettlementDate(fri, cfg);
  assert(sd === "2026-08-14", `Fri AM expect 2026-08-14 got ${sd}`);
}

// Case 4: Thursday 23:59 exactly still this Friday; 00:00 Friday next
{
  const thu2359 = atKL(2026, 8, 6, 23, 59);
  assert(computeSettlementDate(thu2359, cfg) === "2026-08-07", "Thu 23:59 this Fri");
  const fri0000 = atKL(2026, 8, 7, 0, 0);
  assert(computeSettlementDate(fri0000, cfg) === "2026-08-14", "Fri 00:00 next Fri");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      cases: ["mon→thisFri", "thu22→thisFri", "friAM→nextFri", "cutoff"],
      timezone: cfg.timezone,
      cutoff: `weekday ${cfg.application_cutoff_weekday} ${cfg.application_cutoff_time}`,
    },
    null,
    2
  )
);
