const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { calculatePauseDeduction, applyPauseDailyCap } = require("../src/utils/pauseDeduction");

describe("pause salary deduction", () => {
  it("deducts only minutes beyond allowance and grace", () => {
    assert.deepEqual(calculatePauseDeduction({
      enabled: true,
      actualMinutes: 50,
      allowedMinutes: 30,
      graceMinutes: 5,
      method: "HOURLY_RATE",
      hourlyRate: 144.23,
    }), { extraMinutes: 15, amount: 36.06 });
  });

  it("supports fixed per-minute deductions", () => {
    assert.deepEqual(calculatePauseDeduction({
      enabled: true,
      actualMinutes: 75,
      allowedMinutes: 60,
      graceMinutes: 0,
      method: "FIXED_PER_MINUTE",
      fixedPerMinute: 2.5,
    }), { extraMinutes: 15, amount: 37.5 });
  });

  it("does not deduct disabled or still-open sessions", () => {
    assert.deepEqual(calculatePauseDeduction({ enabled: false, actualMinutes: 100, allowedMinutes: 0, graceMinutes: 0, method: "HOURLY_RATE", hourlyRate: 100 }), { extraMinutes: 0, amount: 0 });
  });

  it("applies one shared daily cap across break and lunch", () => {
    assert.deepEqual(applyPauseDailyCap({ breakAmount: 80, lunchAmount: 40, cap: 60 }), { breakDeduction: 40, lunchDeduction: 20, pauseDeduction: 60 });
  });
});
