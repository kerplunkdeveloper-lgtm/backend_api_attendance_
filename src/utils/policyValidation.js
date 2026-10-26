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

/**
 * The company's weekly off days, as the CSV stored on the policy ("0" = Sunday ... "6" = Saturday).
 * Accepts an array or a CSV. A company may have no weekly off, but not more than three, so it always has
 * working days.
 */
const normalizeWeeklyOffDays = (value) => {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  const days = parts.map((part) => String(part).trim()).filter((part) => part !== "");
  const numbers = days.map(Number);
  if (numbers.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    const error = new Error("Weekly off days must be weekdays from 0 (Sunday) to 6 (Saturday).");
    error.statusCode = 400;
    throw error;
  }
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  if (unique.length > 3) {
    const error = new Error("Choose at most 3 weekly off days.");
    error.statusCode = 400;
    throw error;
  }
  return unique.join(",");
};

/** The working days (CSV) that go with a set of weekly off days: every other day of the week. */
const workingDaysFromWeeklyOff = (weeklyOffDays) => {
  const off = new Set(String(weeklyOffDays ?? "").split(",").filter(Boolean).map(Number));
  return [0, 1, 2, 3, 4, 5, 6].filter((day) => !off.has(day)).join(",");
};

module.exports = { boundedNumber, normalizeWeeklyOffDays, workingDaysFromWeeklyOff };
