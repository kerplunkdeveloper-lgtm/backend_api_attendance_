/**
 * Payroll cycle, day basis and deduction rules. Pure functions only, so the
 * calendar logic can be tested without a database.
 */
const DAY_BASES = ["ACTUAL_DAYS", "FIXED_30", "WORKING_DAYS"];
const HOURS_PER_DAY = 8;
const DAY_MS = 86400000;

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });

const round2 = (value) => Math.round(value * 100) / 100;

const toIsoKey = (time) => new Date(time).toISOString().slice(0, 10);

const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/** Clamps a cycle day to the month, so day 31 means "last day" in short months. */
const clampDay = (year, monthIndex, day) => Math.min(Math.max(1, day), daysInMonth(year, monthIndex));

const normalizeCycleDay = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw invalid("Payroll cycle days must be whole numbers from 1 to 31");
  }
  return day;
};

const normalizeDayBasis = (value, fallback = "ACTUAL_DAYS") => {
  if (value === undefined || value === null || value === "") return fallback;
  const basis = String(value).trim().toUpperCase();
  if (!DAY_BASES.includes(basis)) throw invalid(`Day basis must be one of ${DAY_BASES.join(", ")}`);
  return basis;
};

/**
 * Payroll period for a payroll month. The month is the month the cycle ends in.
 *  - startDay < endDay: both days fall in the same month, inclusive (1 to 30 = 1st..30th).
 *  - startDay >= endDay: from startDay of the previous month up to the day before endDay
 *    (5 to 5 = 5th of the previous month .. 4th of this month, so the next cycle starts on the 5th).
 */
const getPayrollPeriod = (month, year, startDay = 1, endDay = 31) => {
  const monthIndex = Number(month) - 1;
  const y = Number(year);
  let start;
  let end;

  if (startDay < endDay) {
    start = Date.UTC(y, monthIndex, clampDay(y, monthIndex, startDay));
    end = Date.UTC(y, monthIndex, clampDay(y, monthIndex, endDay));
  } else {
    const prevIndex = monthIndex === 0 ? 11 : monthIndex - 1;
    const prevYear = monthIndex === 0 ? y - 1 : y;
    start = Date.UTC(prevYear, prevIndex, clampDay(prevYear, prevIndex, startDay));
    end = Date.UTC(y, monthIndex, clampDay(y, monthIndex, endDay)) - DAY_MS;
  }

  return {
    start: new Date(start),
    end: new Date(end),
    days: Math.round((end - start) / DAY_MS) + 1,
  };
};

/** Days used as the divisor for a day's pay: the actual period, a fixed 30, or the policy working days. */
const resolveDayBasis = (basis, period, workingDaysPerMonth = 26) => {
  if (basis === "FIXED_30") return 30;
  if (basis === "WORKING_DAYS") return Number(workingDaysPerMonth) || 26;
  return period.days;
};

/** Parses a Shift.workingDays CSV ("1,2,3,4,5,6", 0 = Sunday). Falls back to Mon-Sat. */
const parseWorkingDays = (csv) => {
  if (!csv || typeof csv !== "string") return new Set([1, 2, 3, 4, 5, 6]);
  const parsed = csv
    .split(",")
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return parsed.length ? new Set(parsed) : new Set([1, 2, 3, 4, 5, 6]);
};

/**
 * Counts how each day of the period was paid or lost. Holidays and week-offs are
 * neutral. Days after `asOf` are not counted, and today is skipped until a record exists.
 *
 * @param {object} input
 * @param {{start: Date, end: Date}} input.period
 * @param {Date} input.asOf last day that has happened in the organization's timezone
 * @param {Set<number>} input.workingDays weekday numbers (0 = Sunday) the employee works
 * @param {Set<string>} input.holidayKeys YYYY-MM-DD keys that apply to the employee
 * @param {Map<string, string>} input.attendanceStatusByKey status per YYYY-MM-DD
 * @param {Set<string>} input.unpaidLeaveKeys approved loss-of-pay leave days
 * @param {Map<string, {isPaid: boolean}>} [input.companyLeaveByKey] company-wide leave days that apply to the employee
 * @param {string} input.todayKey the organization's current YYYY-MM-DD
 */
const classifyPayrollDays = ({
  period,
  asOf,
  workingDays,
  holidayKeys,
  attendanceStatusByKey,
  unpaidLeaveKeys,
  companyLeaveByKey = new Map(),
  todayKey,
}) => {
  const result = {
    presentDays: 0,
    halfDays: 0,
    lateCount: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    holidayDays: 0,
    weekOffDays: 0,
    companyLeaveDays: 0,
  };
  const last = Math.min(period.end.getTime(), new Date(asOf).getTime());

  for (let t = period.start.getTime(); t <= last; t += DAY_MS) {
    const key = toIsoKey(t);
    const status = attendanceStatusByKey.get(key);

    if (holidayKeys.has(key) || status === "HOLIDAY") {
      result.holidayDays += 1;
    } else if (status === "WEEK_OFF" || !workingDays.has(new Date(t).getUTCDay())) {
      result.weekOffDays += 1;
    } else if (status === "PRESENT" || status === "WORK_FROM_HOME") {
      result.presentDays += 1;
    } else if (status === "LATE") {
      result.presentDays += 1;
      result.lateCount += 1;
    } else if (status === "HALF_DAY") {
      result.presentDays += 0.5;
      result.halfDays += 1;
      result.unpaidLeaveDays += 0.5;
    } else if (status === "ON_LEAVE") {
      if (unpaidLeaveKeys.has(key)) result.unpaidLeaveDays += 1;
      else result.paidLeaveDays += 1;
    } else if (companyLeaveByKey.has(key)) {
      // Company-wide leave with no attendance record: paid or loss of pay as the company set it.
      result.companyLeaveDays += 1;
      if (companyLeaveByKey.get(key).isPaid) result.paidLeaveDays += 1;
      else result.unpaidLeaveDays += 1;
    } else if (!status && key === todayKey) {
      // Today is still in progress and has no record yet, so it is not a loss-of-pay day.
    } else {
      result.unpaidLeaveDays += 1;
    }
  }

  return result;
};

/**
 * Expands company-wide leave records into a per-day map for one cycle. If records overlap on a
 * day, the day is unpaid when any of them is unpaid.
 */
const buildCompanyLeaveMap = (records, period) => {
  const byKey = new Map();
  for (const record of records) {
    const first = Math.max(new Date(record.startDate).getTime(), period.start.getTime());
    const last = Math.min(new Date(record.endDate).getTime(), period.end.getTime());
    for (let t = first; t <= last; t += DAY_MS) {
      const key = toIsoKey(t);
      const previous = byKey.get(key);
      byKey.set(key, { isPaid: previous ? previous.isPaid && Boolean(record.isPaid) : Boolean(record.isPaid) });
    }
  }
  return byKey;
};

/** Hours used beyond the monthly permission allowance, priced at the hourly rate. */
const computePermissionDeduction = ({ approvedHours, allowanceHours, dailyRate }) => {
  const used = Math.max(0, Number(approvedHours) || 0);
  const allowance = Math.max(0, Number(allowanceHours) || 0);
  const excessHours = round2(Math.max(0, used - allowance));
  const hourlyRate = dailyRate / HOURS_PER_DAY;
  return { excessHours, deduction: round2(excessHours * hourlyRate) };
};

/** A permission is a short absence in quarter-hour steps, between 15 minutes and one working day. */
const normalizePermissionHours = (value) => {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0.25 || hours > HOURS_PER_DAY) {
    throw invalid("Permission hours must be between 0.25 and 8");
  }
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) {
    throw invalid("Permission hours must be in quarter-hour steps (0.25, 0.5, 0.75 ...)");
  }
  return hours;
};

module.exports = {
  DAY_BASES,
  HOURS_PER_DAY,
  normalizeCycleDay,
  normalizeDayBasis,
  getPayrollPeriod,
  resolveDayBasis,
  parseWorkingDays,
  classifyPayrollDays,
  computePermissionDeduction,
  normalizePermissionHours,
  buildCompanyLeaveMap,
  toIsoKey,
  round2,
};
