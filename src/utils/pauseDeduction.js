const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Calculate one pause deduction from a completed attendance record.
 * The allowance belongs to the employee's shift; the salary rate belongs to
 * the payroll calculation, so this helper stays independent of Prisma.
 */
const calculatePauseDeduction = ({ enabled, actualMinutes, allowedMinutes, graceMinutes, method, fixedPerMinute, hourlyRate }) => {
  if (!enabled) return { extraMinutes: 0, amount: 0 };
  const extraMinutes = Math.max(0, Math.floor(Number(actualMinutes) || 0) - Math.floor(Number(allowedMinutes) || 0) - Math.floor(Number(graceMinutes) || 0));
  if (!extraMinutes) return { extraMinutes: 0, amount: 0 };

  const amount = method === "FIXED_PER_MINUTE"
    ? extraMinutes * (Number(fixedPerMinute) || 0)
    : (extraMinutes / 60) * (Number(hourlyRate) || 0);
  return { extraMinutes, amount: round2(amount) };
};

/** Apply a shared per-day cap while preserving the break/lunch split. */
const applyPauseDailyCap = ({ breakAmount, lunchAmount, cap }) => {
  const total = (Number(breakAmount) || 0) + (Number(lunchAmount) || 0);
  const limit = Number(cap) || 0;
  if (!limit || total <= limit) {
    return { breakDeduction: round2(breakAmount), lunchDeduction: round2(lunchAmount), pauseDeduction: round2(total) };
  }
  const factor = limit / total;
  const cappedBreak = round2((Number(breakAmount) || 0) * factor);
  const cappedLunch = round2(Math.max(0, limit - cappedBreak));
  return { breakDeduction: cappedBreak, lunchDeduction: cappedLunch, pauseDeduction: round2(cappedBreak + cappedLunch) };
};

module.exports = { calculatePauseDeduction, applyPauseDailyCap };
