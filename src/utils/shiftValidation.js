/** Input checks for shifts. Payroll and lateness are computed from these strings, so garbage must not be stored. */

const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

const assertTime = (label, value) => {
  const text = String(value || "").trim();
  if (!TIME_PATTERN.test(text)) {
    const error = new Error(`${label} must be a time like 09:00 or 18:30.`);
    error.statusCode = 400;
    throw error;
  }
  return text;
};

/** Working days as "1,2,3,4,5" (0 = Sunday ... 6 = Saturday). Returns the normalised, de-duplicated list. */
const normalizeWorkingDays = (value) => {
  const days = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const numbers = days.map(Number);
  if (!numbers.length || numbers.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    const error = new Error("Working days must be numbers from 0 (Sunday) to 6 (Saturday), for example 1,2,3,4,5.");
    error.statusCode = 400;
    throw error;
  }
  return [...new Set(numbers)].sort((a, b) => a - b).join(",");
};

module.exports = { assertTime, normalizeWorkingDays };
