const test = require("node:test");
const assert = require("node:assert/strict");
const { proRataFinalSalary, encashableLeaveDays } = require("../src/utils/finalSettlementMath");

test("pro-rates the full monthly gross by calendar days to the last working day", () => {
  const result = proRataFinalSalary(30000, new Date("2026-06-15T00:00:00Z"));
  assert.equal(result.days, 15);
  assert.equal(result.daysInMonth, 30);
  assert.equal(result.amount, 15000);
});

test("a last working day at month end pays the whole month, including in February", () => {
  assert.equal(proRataFinalSalary(31000, new Date("2026-07-31T00:00:00Z")).amount, 31000);
  assert.equal(proRataFinalSalary(28000, new Date("2026-02-28T00:00:00Z")).amount, 28000);
});

test("does not pay a 20th-of-the-month exit as if 20 of 26 working days were worked", () => {
  const result = proRataFinalSalary(26000, new Date("2026-06-20T00:00:00Z"));
  assert.equal(result.amount, 17333.33);
});

const balance = (name, allocated, used, extra = {}) => ({
  year: 2026,
  allocatedDays: allocated,
  usedDays: used,
  leaveType: { name, isPaid: true },
  ...extra,
});

test("encashes only the remaining earned, privilege or annual leave", () => {
  const days = encashableLeaveDays(
    [balance("Earned / Annual Leave", 15, 4), balance("Casual Leave", 12, 0), balance("Sick Leave", 10, 0)],
    2026,
  );
  assert.equal(days, 11);
});

test("never encashes unpaid leave, even though its name contains 'paid'", () => {
  const days = encashableLeaveDays([{ ...balance("Unpaid Leave (LWP)", 30, 0), leaveType: { name: "Unpaid Leave (LWP)", isPaid: false } }], 2026);
  assert.equal(days, 0);
});

test("ignores other years and over-used balances", () => {
  assert.equal(encashableLeaveDays([balance("Annual Leave", 15, 0, { year: 2025 })], 2026), 0);
  assert.equal(encashableLeaveDays([balance("Annual Leave", 15, 20)], 2026), 0);
});

test("returns 0, never NaN, when there are no balances", () => {
  assert.equal(encashableLeaveDays([], 2026), 0);
  assert.equal(encashableLeaveDays(undefined, 2026), 0);
});
