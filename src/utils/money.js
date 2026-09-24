/**
 * Currency helpers.
 *
 * Payroll columns are `Decimal` in Postgres but JavaScript has no decimal type,
 * so every intermediate value is carried as an integer number of minor units
 * (paise/cents) and only converted back at the boundary. This keeps
 * `0.1 + 0.2`-style drift out of salary totals.
 */

const MINOR_UNITS = 100;

/** Convert a major-unit amount (rupees) to integer minor units (paise). */
const toMinor = (value) => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * MINOR_UNITS);
};

/** Convert integer minor units back to a major-unit number with 2 decimals. */
const toMajor = (minor) => Math.round(minor) / MINOR_UNITS;

/** Sum any mix of major-unit values without accumulating float error. */
const sum = (...values) => toMajor(values.reduce((acc, v) => acc + toMinor(v), 0));

/** Subtract `b` from `a` in major units. */
const subtract = (a, b) => toMajor(toMinor(a) - toMinor(b));

/** Multiply a major-unit amount by a plain factor (e.g. a rate or day count). */
const multiply = (value, factor) => {
  const f = Number(factor);
  if (!Number.isFinite(f)) return 0;
  return toMajor(toMinor(value) * f);
};

/** Divide a major-unit amount by a plain divisor, guarding against divide-by-zero. */
const divide = (value, divisor) => {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d === 0) return 0;
  return toMajor(toMinor(value) / d);
};

/** Round a major-unit amount to 2 decimal places. */
const round = (value) => toMajor(toMinor(value));

/** Clamp a major-unit amount to zero or above. */
const atLeastZero = (value) => (toMinor(value) < 0 ? 0 : round(value));

module.exports = {
  toMinor,
  toMajor,
  sum,
  subtract,
  multiply,
  divide,
  round,
  atLeastZero,
};
