/** Pure calculations for the Full & Final settlement, kept apart from Prisma so they can be tested. */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Salary for the part of the last month the employee actually worked: the full monthly gross
 * (allowances included, as payroll pays them) pro-rated by calendar days up to the last working day.
 * The day count previously used the day-of-month against a 26-day basis, which overpaid a mid-month exit.
 */
const proRataFinalSalary = (monthlyGross, lastWorkingDate) => {
  const lwd = new Date(lastWorkingDate);
  const year = lwd.getUTCFullYear();
  const month = lwd.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = Math.min(lwd.getUTCDate(), daysInMonth);
  const ratio = days / daysInMonth;
  return { days, daysInMonth, ratio, amount: round2(Number(monthlyGross || 0) * ratio) };
};

const ENCASHABLE_NAME = /privilege|earned|annual/i;

/**
 * Leave days that are paid out at exit: the remaining balance of paid earned / privilege / annual
 * leave for the year of the last working day. Casual and sick leave lapse, unpaid leave has no value,
 * and balances from other years are not mixed in.
 */
const encashableLeaveDays = (leaveBalances, year) => {
  const total = (leaveBalances || []).reduce((sum, balance) => {
    const type = balance.leaveType || {};
    if (balance.year !== year || type.isPaid === false || !ENCASHABLE_NAME.test(type.name || "")) return sum;
    return sum + Math.max(0, Number(balance.allocatedDays || 0) - Number(balance.usedDays || 0));
  }, 0);
  return round2(total);
};

module.exports = { proRataFinalSalary, encashableLeaveDays, round2 };
