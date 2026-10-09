/**
 * Percentage split of monthly CTC into salary components. The default matches
 * the split used when an employee is created with an annual CTC.
 */
const DEFAULT_SPLIT = { basic: 50, hra: 25, special: 15, other: 10 };

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });

/** Fills missing keys with defaults and rejects anything that is not a 100% split. */
const normalizeSplit = (split = {}) => {
  const result = {};
  for (const key of Object.keys(DEFAULT_SPLIT)) {
    const raw = split[key] === undefined || split[key] === "" ? DEFAULT_SPLIT[key] : Number(split[key]);
    if (!Number.isFinite(raw) || raw < 0) throw invalid(`Split for ${key} must be a non-negative number`);
    result[key] = raw;
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.001) throw invalid("Salary split percentages must add up to 100");
  if (result.basic <= 0) throw invalid("Basic percentage must be above 0");
  return result;
};

/** Monthly components from an annual CTC. Components are rounded to whole rupees. */
const buildSalaryBreakdown = (annualCtc, split = DEFAULT_SPLIT) => {
  const annual = Number(annualCtc);
  if (!Number.isFinite(annual) || annual <= 0) throw invalid("Annual CTC must be a positive number");
  const monthly = annual / 12;
  const part = (percent) => Math.round((monthly * percent) / 100);
  return {
    annualCtc: annual,
    monthlyCtc: Number(monthly.toFixed(2)),
    baseSalary: part(split.basic),
    hra: part(split.hra),
    special: part(split.special),
    otherAllowance: part(split.other),
  };
};

module.exports = { DEFAULT_SPLIT, normalizeSplit, buildSalaryBreakdown };
