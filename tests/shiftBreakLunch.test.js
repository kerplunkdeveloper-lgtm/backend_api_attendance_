const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAttendanceAgainstShift } = require("../src/utils/shiftCalculator");

test("included break and lunch reduce the productive target", () => {
  const shift = {
    startTime: "09:00",
    endTime: "18:00",
    graceMinutes: 15,
    breakMinutes: 15,
    lunchMinutes: 45,
    breakIncluded: true,
    lunchIncluded: true,
  };
  const result = evaluateAttendanceAgainstShift(
    shift,
    "2026-10-13T03:30:00.000Z",
    "2026-10-13T12:30:00.000Z",
    15,
    { lunchMinutes: 45, timeZone: "Asia/Calcutta" }
  );
  assert.equal(result.scheduledMinutes, 540);
  assert.equal(result.scheduledWorkMinutes, 480);
  assert.equal(result.workingMinutes, 480);
  assert.equal(result.totalPauseMinutes, 60);
  assert.equal(result.overtimeMinutes, 0);
});

test("overtime starts after the productive target", () => {
  const result = evaluateAttendanceAgainstShift(
    { startTime: "09:00", endTime: "18:00", graceMinutes: 15, breakMinutes: 15, lunchMinutes: 45, breakIncluded: true, lunchIncluded: true },
    "2026-10-13T03:30:00.000Z",
    "2026-10-13T13:30:00.000Z",
    15,
    { lunchMinutes: 45, timeZone: "Asia/Calcutta" }
  );
  assert.equal(result.workingMinutes, 540);
  assert.equal(result.overtimeMinutes, 60);
});