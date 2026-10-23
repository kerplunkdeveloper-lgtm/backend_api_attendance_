const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTime, normalizeWorkingDays } = require("../src/utils/shiftValidation");

test("accepts valid wall-clock times", () => {
  assert.equal(assertTime("Start", "09:00"), "09:00");
  assert.equal(assertTime("End", " 18:30 "), "18:30");
  assert.equal(assertTime("Start", "9:05"), "9:05");
});

test("rejects times that are not HH:mm", () => {
  for (const bad of ["", "25:00", "09:60", "nine", "9", "09:00 PM", null]) {
    assert.throws(() => assertTime("Start", bad), (err) => err.statusCode === 400, String(bad));
  }
});

test("normalises working days and removes duplicates", () => {
  assert.equal(normalizeWorkingDays("1, 2,3,3,5"), "1,2,3,5");
  assert.equal(normalizeWorkingDays("6,0"), "0,6");
});

test("rejects empty or out-of-range working days", () => {
  for (const bad of ["", "abc", "1,7", "-1", "1.5", null]) {
    assert.throws(() => normalizeWorkingDays(bad), (err) => err.statusCode === 400, String(bad));
  }
});
