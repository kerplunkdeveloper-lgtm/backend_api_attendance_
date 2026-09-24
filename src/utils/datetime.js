/**
 * Timezone-aware date helpers.
 *
 * Attendance is bucketed by *calendar date*, but the server may run anywhere.
 * Deriving that date from the server's UTC offset means a tenant in IST has
 * every punch between 00:00 and 05:30 local recorded against the previous day.
 *
 * Everything here converts an instant into the tenant's own local calendar date
 * and stores it as UTC midnight of that date, which is what a Postgres `DATE`
 * column round-trips cleanly.
 */

const DEFAULT_TIMEZONE = "UTC";

const formatterCache = new Map();

const getFormatter = (timeZone) => {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
    );
  }
  return formatterCache.get(timeZone);
};

/** Returns true when the runtime recognises the IANA zone name. */
const isValidTimeZone = (timeZone) => {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
};

const safeZone = (timeZone) => (isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE);

/**
 * Breaks an instant into its calendar parts *in the given timezone*.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number}}
 */
const getZonedParts = (date, timeZone) => {
  const parts = getFormatter(safeZone(timeZone)).formatToParts(new Date(date));
  const lookup = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = parseInt(part.value, 10);
  }
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour ?? 0,
    minute: lookup.minute ?? 0,
    second: lookup.second ?? 0,
  };
};

/**
 * The calendar date an instant falls on for the tenant, as UTC midnight.
 * This is the value written to (and queried against) `Attendance.date`.
 */
const getLocalDateOnly = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const { year, month, day } = getZonedParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
};

/** Minutes elapsed since local midnight — the basis for late/early comparisons. */
const getLocalMinutesOfDay = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const { hour, minute } = getZonedParts(date, timeZone);
  return hour * 60 + minute;
};

/** Day of week (0=Sunday) in the tenant's timezone. */
const getLocalDayOfWeek = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const { year, month, day } = getZonedParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** "YYYY-MM-DD" for the tenant's calendar date. */
const toLocalDateKey = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Parses "HH:mm" into minutes since midnight. Returns null when unparseable. */
const parseTimeToMinutes = (value) => {
  if (!value || typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/**
 * True when a shift's end time is earlier than its start time, i.e. it runs
 * past midnight into the following calendar day.
 */
const isOvernightShift = (shift) => {
  const start = parseTimeToMinutes(shift?.startTime);
  const end = parseTimeToMinutes(shift?.endTime);
  if (start === null || end === null) return false;
  return end <= start;
};

module.exports = {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  getZonedParts,
  getLocalDateOnly,
  getLocalMinutesOfDay,
  getLocalDayOfWeek,
  toLocalDateKey,
  parseTimeToMinutes,
  isOvernightShift,
};
