/**
 * Validates one numeric policy field. Policy numbers feed payroll (late deductions, half-day cut-off,
 * permission allowance), so a stray 50 where a 0-1 fraction belongs, or NaN from "abc", must be
 * rejected rather than stored.
 */
const boundedNumber = (label, value, { min, max, integer = false }) => {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  const valid = value !== "" && value !== null && Number.isFinite(parsed) && (!integer || Number.isInteger(parsed));
  if (!valid || parsed < min || parsed > max) {
    const error = new Error(`${label} must be ${integer ? "a whole number" : "a number"} between ${min} and ${max}.`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
};

module.exports = { boundedNumber };
