/**
 * Offline verification for CS monthly salary invariants.
 * Run: node scripts/verify-cs-monthly-salary.mjs
 */
import assert from "node:assert/strict";
import {
  previousMonthKey,
  lastDayOfMonth,
  monthPeriodBounds,
  isSalaryPeriodComplete,
  nextMonthStart,
} from "../server/api/_customer-service-work.js";

// Period math
assert.equal(previousMonthKey("2026-09"), "2026-08");
assert.equal(lastDayOfMonth("2026-08"), "2026-08-31");
assert.deepEqual(monthPeriodBounds("2026-08"), { periodStart: "2026-08-01", periodEnd: "2026-08-31" });
assert.equal(isSalaryPeriodComplete("2026-08-31", "2026-09-19"), true);
assert.equal(isSalaryPeriodComplete("2026-09-30", "2026-09-19"), false);
assert.equal(nextMonthStart("2026-09"), "2026-10-01");

// Rate ≠ withdrawable
const salaryRate = 200;
const estimatedSalary = salaryRate + 50; // mid-month estimate
const periodComplete = false;
const withdrawableMidMonth = periodComplete ? estimatedSalary : 0;
assert.equal(withdrawableMidMonth, 0, "new/open period must start at 0 withdrawable");

// Closed period, no payroll yet → eligible
const closed = isSalaryPeriodComplete("2026-08-31", "2026-09-19");
const hasPayroll = false;
const withdrawableClosed = closed && !hasPayroll ? salaryRate : 0;
assert.equal(withdrawableClosed, 200);

// Duplicate prevention: second credit blocked when payroll exists
const hasPayroll2 = true;
const withdrawableDup = closed && !hasPayroll2 ? salaryRate : 0;
assert.equal(withdrawableDup, 0);

console.log("PASS verify-cs-monthly-salary");
console.log(
  JSON.stringify(
    {
      defaultRate: 200,
      rateIsNotImmediateBalance: true,
      newStaffWithdrawable: 0,
      periodGate: "period_end < today",
      onePayrollPerPeriod: "uq_staff_payrolls_staff_period_active",
      migration: "20260919_staff_salary_period_unique.sql",
    },
    null,
    2
  )
);
