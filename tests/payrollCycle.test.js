const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCycleDay,
  normalizeDayBasis,
  getPayrollPeriod,
  resolveDayBasis,
  parseWorkingDays,
  classifyPayrollDays,
  computePermissionDeduction,
  normalizePermissionHours,
  toIsoKey,
} = require("../src/utils/payrollCycle");

const range = (period) => [toIsoKey(period.start), toIsoKey(period.end), period.days];

describe("payroll period", () => {
  it("calendar month: 1 to 31 covers the whole month, including short Februaries", () => {
    assert.deepEqual(range(getPayrollPeriod(2, 2027, 1, 31)), ["2027-02-01", "2027-02-28", 28]);
    assert.deepEqual(range(getPayrollPeriod(2, 2028, 1, 31)), ["2028-02-01", "2028-02-29", 29]);
  });

  it("same-month cycle: 1 to 30 is the 1st through the 30th", () => {
    assert.deepEqual(range(getPayrollPeriod(6, 2026, 1, 30)), ["2026-06-01", "2026-06-30", 30]);
  });

  it("5 to 5 cycle runs from the 5th of the previous month to the 4th of the labelled month", () => {
    assert.deepEqual(range(getPayrollPeriod(1, 2027, 5, 5)), ["2026-12-05", "2027-01-04", 31]);
  });

  it("20 to 20 cycle: the labelled month is the month the cycle ends in", () => {
    assert.deepEqual(range(getPayrollPeriod(2, 2027, 20, 20)), ["2027-01-20", "2027-02-19", 31]);
  });

  it("21 to 20 cycle ending in March 2027 runs 21 Feb to 19 Mar, which is 27 days", () => {
    assert.deepEqual(range(getPayrollPeriod(3, 2027, 21, 20)), ["2027-02-21", "2027-03-19", 27]);
  });

  it("clamps day 31 to the end of short months when used as a start day", () => {
    assert.deepEqual(range(getPayrollPeriod(2, 2027, 1, 31)), ["2027-02-01", "2027-02-28", 28]);
    assert.deepEqual(range(getPayrollPeriod(3, 2027, 31, 30)), ["2027-02-28", "2027-03-29", 30]);
  });
});

describe("day basis", () => {
  const period = getPayrollPeriod(2, 2027, 1, 31);

  it("uses the actual period length, a fixed 30, or the policy working days", () => {
    assert.equal(resolveDayBasis("ACTUAL_DAYS", period, 26), 28);
    assert.equal(resolveDayBasis("FIXED_30", period, 26), 30);
    assert.equal(resolveDayBasis("WORKING_DAYS", period, 24), 24);
    assert.equal(resolveDayBasis("WORKING_DAYS", period, undefined), 26);
  });

  it("validates cycle days and day basis", () => {
    assert.equal(normalizeCycleDay(undefined, 1), 1);
    assert.equal(normalizeCycleDay("20", 1), 20);
    assert.throws(() => normalizeCycleDay(0, 1), (e) => e.statusCode === 400);
    assert.throws(() => normalizeCycleDay(32, 1), (e) => e.statusCode === 400);
    assert.equal(normalizeDayBasis("fixed_30"), "FIXED_30");
    assert.equal(normalizeDayBasis(undefined), "ACTUAL_DAYS");
    assert.throws(() => normalizeDayBasis("MONTHLY"), (e) => e.statusCode === 400);
  });

  it("parses shift working days and falls back to Monday to Saturday", () => {
    assert.deepEqual([...parseWorkingDays("1,2,3,4,5")].sort(), [1, 2, 3, 4, 5]);
    assert.deepEqual([...parseWorkingDays(null)].sort(), [1, 2, 3, 4, 5, 6]);
  });
});

describe("day classification", () => {
  // 1 Feb 2027 is a Monday, so 7 Feb is a Sunday week-off for a Mon-Sat shift.
  const period = getPayrollPeriod(2, 2027, 1, 7);
  const workingDays = new Set([1, 2, 3, 4, 5, 6]);

  const classify = (overrides = {}) =>
    classifyPayrollDays({
      period,
      asOf: period.end,
      workingDays,
      holidayKeys: new Set(["2027-02-03"]),
      attendanceStatusByKey: new Map([
        ["2027-02-01", "PRESENT"],
        ["2027-02-04", "ON_LEAVE"],
        ["2027-02-05", "ON_LEAVE"],
        ["2027-02-06", "HALF_DAY"],
      ]),
      unpaidLeaveKeys: new Set(["2027-02-04"]),
      todayKey: "2027-02-07",
      ...overrides,
    });

  it("pays holidays and week-offs, counts loss-of-pay days, and halves half days", () => {
    const result = classify();
    assert.equal(result.presentDays, 1.5);
    assert.equal(result.halfDays, 1);
    assert.equal(result.paidLeaveDays, 1);
    assert.equal(result.unpaidLeaveDays, 2.5); // 2 Feb with no record, 4 Feb unpaid leave, half of 6 Feb
    assert.equal(result.holidayDays, 1);
    assert.equal(result.weekOffDays, 1);
  });

  it("does not count today as loss of pay while it has no record yet", () => {
    const result = classify({ todayKey: "2027-02-02" });
    assert.equal(result.unpaidLeaveDays, 1.5);
  });

  it("does not count days after the as-of date", () => {
    const result = classify({ asOf: new Date("2027-02-02T00:00:00Z"), todayKey: "2027-02-02" });
    assert.equal(result.unpaidLeaveDays, 0); // 1 Feb is present, 2 Feb is today with no record yet, later days are ignored
    assert.equal(result.presentDays, 1);
  });

  it("treats a stored WEEK_OFF status as neutral even on a working weekday", () => {
    const result = classify({
      attendanceStatusByKey: new Map([["2027-02-02", "WEEK_OFF"]]),
      todayKey: "2027-02-07",
    });
    assert.equal(result.weekOffDays, 2); // 2 Feb stored week-off, 7 Feb Sunday
    assert.equal(result.holidayDays, 1); // 3 Feb holiday
    assert.equal(result.unpaidLeaveDays, 4); // 1, 4, 5 and 6 Feb have no record and are not today
  });
});

describe("permissions", () => {
  it("is free within the monthly allowance", () => {
    assert.deepEqual(computePermissionDeduction({ approvedHours: 3, allowanceHours: 3, dailyRate: 1000 }), {
      excessHours: 0,
      deduction: 0,
    });
  });

  it("prices hours beyond the allowance at the hourly rate (daily rate / 8)", () => {
    assert.deepEqual(computePermissionDeduction({ approvedHours: 5, allowanceHours: 3, dailyRate: 1000 }), {
      excessHours: 2,
      deduction: 250,
    });
  });

  it("accepts quarter-hour steps and rejects anything else", () => {
    assert.equal(normalizePermissionHours(0.25), 0.25);
    assert.equal(normalizePermissionHours("1.5"), 1.5);
    assert.throws(() => normalizePermissionHours(0.3), (e) => e.statusCode === 400);
    assert.throws(() => normalizePermissionHours(0), (e) => e.statusCode === 400);
    assert.throws(() => normalizePermissionHours(9), (e) => e.statusCode === 400);
  });
});

describe("company-wide leave", () => {
  const period = getPayrollPeriod(2, 2027, 1, 7);
  const base = {
    period,
    asOf: period.end,
    workingDays: new Set([1, 2, 3, 4, 5, 6]),
    holidayKeys: new Set(),
    unpaidLeaveKeys: new Set(),
    todayKey: "2027-02-07",
  };
  const companyLeaveByKey = new Map([
    ["2027-02-02", { isPaid: false }],
    ["2027-02-03", { isPaid: false }],
    ["2027-02-04", { isPaid: true }],
  ]);

  it("charges unpaid company leave as loss of pay and pays paid company leave", () => {
    const result = classifyPayrollDays({
      ...base,
      attendanceStatusByKey: new Map(),
      companyLeaveByKey,
    });
    assert.equal(result.companyLeaveDays, 3);
    assert.equal(result.paidLeaveDays, 1); // 4 Feb paid company leave
    assert.equal(result.unpaidLeaveDays, 5); // 1, 2, 3, 5, 6 Feb with no record
  });

  it("an attendance record that exists wins over company leave", () => {
    const result = classifyPayrollDays({
      ...base,
      attendanceStatusByKey: new Map([["2027-02-02", "PRESENT"]]),
      companyLeaveByKey,
    });
    assert.equal(result.presentDays, 1);
    assert.equal(result.companyLeaveDays, 2); // 3 and 4 Feb only
    assert.equal(result.unpaidLeaveDays, 4); // 1, 3, 5, 6 Feb
  });
});

describe("company leave map", () => {
  it("expands records to the days of the cycle and lets an unpaid record win on overlap", () => {
    const { buildCompanyLeaveMap } = require("../src/utils/payrollCycle");
    const period = getPayrollPeriod(2, 2027, 1, 7);
    const map = buildCompanyLeaveMap(
      [
        { startDate: new Date("2027-02-03T00:00:00Z"), endDate: new Date("2027-02-05T00:00:00Z"), isPaid: true },
        { startDate: new Date("2027-02-05T00:00:00Z"), endDate: new Date("2027-02-09T00:00:00Z"), isPaid: false },
        { startDate: new Date("2027-01-30T00:00:00Z"), endDate: new Date("2027-02-01T00:00:00Z"), isPaid: true },
      ],
      period,
    );
    assert.deepEqual([...map.keys()].sort(), ["2027-02-01", "2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07"]);
    assert.equal(map.get("2027-02-01").isPaid, true);
    assert.equal(map.get("2027-02-04").isPaid, true);
    assert.equal(map.get("2027-02-05").isPaid, false);
    assert.equal(map.get("2027-02-06").isPaid, false);
  });
});
