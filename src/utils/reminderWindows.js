const {
  getLocalMinutesOfDay,
  getLocalDayOfWeek,
  isValidTimeZone,
} = require("./datetime");

const FALLBACK_TZ = "Asia/Kolkata";
const EVENING_WINDOW_END = 22 * 60 + 59;

const clockMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

const zoneOf = (emp) => {
  const tz = emp?.organization?.timezone;
  if (tz && tz !== "UTC" && isValidTimeZone(tz)) return tz;
  return FALLBACK_TZ;
};

const isWorkingDay = (shift, now, timeZone) =>
  String(shift?.workingDays || "1,2,3,4,5,6")
    .split(",")
    .map((day) => Number(day.trim()))
    .includes(getLocalDayOfWeek(now, timeZone));

/** Morning: from 60 minutes before shift start through start time. */
const isBeforeShiftStartWindow = (now, startMinutes, timeZone) => {
  if (startMinutes === null) return false;
  const current = getLocalMinutesOfDay(now, timeZone);
  const open = Math.max(0, startMinutes - 60);
  return current >= open && current <= startMinutes;
};

/** Evening: from shift end through 22:59 local. */
const isAfterShiftEndWindow = (now, endMinutes, timeZone) => {
  if (endMinutes === null) return false;
  const current = getLocalMinutesOfDay(now, timeZone);
  return current >= endMinutes && current <= EVENING_WINDOW_END;
};

module.exports = {
  FALLBACK_TZ,
  EVENING_WINDOW_END,
  clockMinutes,
  zoneOf,
  isWorkingDay,
  isBeforeShiftStartWindow,
  isAfterShiftEndWindow,
};
