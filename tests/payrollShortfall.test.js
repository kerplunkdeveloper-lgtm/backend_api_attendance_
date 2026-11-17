const test = require("node:test");
const assert = require("node:assert/strict");
const payroll = require("../src/services/payroll.service");

const period = {
  start: new Date("2027-02-01T00:00:00.000Z"),
  end: new Date("2027-02-01T00:00:00.000Z"),
};

const ledger = (workingMinutes, status = "PRESENT") => payroll.buildDailyPayrollLedger({
  period,
  asOf: period.end,
  workingDays: new Set([1]),
  holidayKeys: new Set(),
  attendanceByKey: new Map([["2027-02-01", { status, workingMinutes }]]),
  approvedOvertimeByKey: new Map(),
  unpaidLeaveKeys: new Set(),
  companyLeaveByKey: new Map(),
  todayKey: "2027-02-02",
  dailyRate: 1000,
  hourlyRate: 125,
  requiredProductiveMinutes: 485,
  overtimeMultiplier: 1.5,
  lateComingRules: [],
  maxLatesBeforeDeduction: 3,
  lateDeductionPercent: 0.25,
});

test("deducts productive-hour shortfall proportionally to the shift target", () => {
  const row = ledger(425)[0];

  assert.equal(row.shortfallMinutes, 60);
  assert.equal(row.hoursShortfallDeduction, 123.71);
  assert.equal(row.earnedSalary, 876.29);
});

test("does not deduct short hours after the full productive target is met", () => {
  const row = ledger(485)[0];

  assert.equal(row.shortfallMinutes, 0);
  assert.equal(row.hoursShortfallDeduction, 0);
  assert.equal(row.earnedSalary, 1000);
});

test("keeps the existing half-day rule separate from short-hour deductions", () => {
  const row = ledger(240, "HALF_DAY")[0];

  assert.equal(row.hoursShortfallDeduction, 0);
  assert.equal(row.lopDeduction, 500);
  assert.equal(row.earnedSalary, 500);
});
