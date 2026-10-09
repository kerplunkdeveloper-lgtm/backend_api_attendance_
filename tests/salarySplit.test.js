const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SPLIT, normalizeSplit, buildSalaryBreakdown } = require("../src/utils/salarySplit");

describe("salary split", () => {
  it("uses the 50/25/15/10 default when no split is given", () => {
    assert.deepEqual(normalizeSplit(undefined), DEFAULT_SPLIT);
    assert.deepEqual(normalizeSplit({}), DEFAULT_SPLIT);
  });

  it("fills missing components with defaults and accepts numeric strings", () => {
    assert.deepEqual(normalizeSplit({ basic: "40", hra: 35 }), { basic: 40, hra: 35, special: 15, other: 10 });
  });

  it("rejects splits that do not add up to 100", () => {
    assert.throws(() => normalizeSplit({ basic: 60 }), (e) => e.statusCode === 400 && /add up to 100/.test(e.message));
  });

  it("rejects negative or non-numeric percentages and a zero basic", () => {
    assert.throws(() => normalizeSplit({ hra: -5, special: 20 }), (e) => e.statusCode === 400);
    assert.throws(() => normalizeSplit({ basic: "abc" }), (e) => e.statusCode === 400);
    assert.throws(() => normalizeSplit({ basic: 0, hra: 50, special: 30, other: 20 }), (e) => e.statusCode === 400);
  });

  it("splits annual CTC into monthly components rounded to whole rupees", () => {
    const breakdown = buildSalaryBreakdown(900000, DEFAULT_SPLIT);
    assert.equal(breakdown.annualCtc, 900000);
    assert.equal(breakdown.monthlyCtc, 75000);
    assert.equal(breakdown.baseSalary, 37500);
    assert.equal(breakdown.hra, 18750);
    assert.equal(breakdown.special, 11250);
    assert.equal(breakdown.otherAllowance, 7500);
  });

  it("rejects a missing, zero or negative annual CTC", () => {
    assert.throws(() => buildSalaryBreakdown(undefined), (e) => e.statusCode === 400);
    assert.throws(() => buildSalaryBreakdown(0), (e) => e.statusCode === 400);
    assert.throws(() => buildSalaryBreakdown(-100), (e) => e.statusCode === 400);
  });
});
