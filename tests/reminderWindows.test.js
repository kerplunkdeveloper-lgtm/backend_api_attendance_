const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  clockMinutes,
  zoneOf,
  isWorkingDay,
  isBeforeShiftStartWindow,
  isAfterShiftEndWindow,
} = require("../src/utils/reminderWindows");

const IST = "Asia/Kolkata";
const atIst = (hour, minute) => {
  const totalMinutes = hour * 60 + minute - (5 * 60 + 30);
  return new Date(Date.UTC(2026, 8, 25, Math.floor(totalMinutes / 60), totalMinutes % 60, 0));
};

describe("reminder windows (Asia/Kolkata, 09:00–18:00 shift)", () => {
  it("parses shift clock times", () => {
    assert.equal(clockMinutes("09:00"), 9 * 60);
    assert.equal(clockMinutes("18:00"), 18 * 60);
    assert.equal(clockMinutes("09:00 AM"), 9 * 60);
  });

  it("treats missing or UTC org timezone as Asia/Kolkata", () => {
    assert.equal(zoneOf({}), IST);
    assert.equal(zoneOf({ organization: { timezone: "UTC" } }), IST);
    assert.equal(zoneOf({ organization: { timezone: "Asia/Kolkata" } }), IST);
    assert.equal(zoneOf({ organization: { timezone: "America/New_York" } }), "America/New_York");
  });

  it("sends morning reminders before 9 AM, not after", () => {
    const start = clockMinutes("09:00");
    assert.equal(isBeforeShiftStartWindow(atIst(7, 59), start, IST), false);
    assert.equal(isBeforeShiftStartWindow(atIst(8, 0), start, IST), true);
    assert.equal(isBeforeShiftStartWindow(atIst(8, 50), start, IST), true);
    assert.equal(isBeforeShiftStartWindow(atIst(9, 0), start, IST), true);
    assert.equal(isBeforeShiftStartWindow(atIst(9, 1), start, IST), false);
    assert.equal(isBeforeShiftStartWindow(atIst(16, 30), start, IST), false);
  });

  it("sends evening reminders after 6 PM, not before", () => {
    const end = clockMinutes("18:00");
    assert.equal(isAfterShiftEndWindow(atIst(17, 50), end, IST), false);
    assert.equal(isAfterShiftEndWindow(atIst(17, 59), end, IST), false);
    assert.equal(isAfterShiftEndWindow(atIst(18, 0), end, IST), true);
    assert.equal(isAfterShiftEndWindow(atIst(20, 15), end, IST), true);
    assert.equal(isAfterShiftEndWindow(atIst(22, 59), end, IST), true);
    assert.equal(isAfterShiftEndWindow(atIst(23, 0), end, IST), false);
  });

  it("skips Sunday for the default Mon–Sat working days", () => {
    const shift = { workingDays: "1,2,3,4,5,6" };
    const friday = new Date(Date.UTC(2026, 8, 25, 3, 30));
    const sunday = new Date(Date.UTC(2026, 8, 27, 3, 30));
    assert.equal(isWorkingDay(shift, friday, IST), true);
    assert.equal(isWorkingDay(shift, sunday, IST), false);
  });
});
