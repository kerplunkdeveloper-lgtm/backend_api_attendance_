const test = require("node:test");
const assert = require("node:assert/strict");
const { boundedNumber } = require("../src/utils/policyValidation");

test("accepts values inside the range, including numeric strings", () => {
  assert.equal(boundedNumber("Late deduction", 0.25, { min: 0, max: 1 }), 0.25);
  assert.equal(boundedNumber("Late deduction", "0.5", { min: 0, max: 1 }), 0.5);
  assert.equal(boundedNumber("Working days", 26, { min: 1, max: 31, integer: true }), 26);
});

test("rejects a percentage typed where a 0-1 fraction belongs", () => {
  assert.throws(() => boundedNumber("Late deduction", 50, { min: 0, max: 1 }), (err) => err.statusCode === 400 && /between 0 and 1/.test(err.message));
});

test("rejects garbage, empty and non-finite input instead of storing NaN", () => {
  for (const bad of ["abc", "", null, undefined, NaN, Infinity]) {
    assert.throws(() => boundedNumber("Half-day threshold", bad, { min: 0, max: 1440, integer: true }), (err) => err.statusCode === 400);
  }
});

test("rejects fractions where a whole number is required", () => {
  assert.throws(() => boundedNumber("Max lates", 2.5, { min: 0, max: 31, integer: true }), /whole number/);
});
