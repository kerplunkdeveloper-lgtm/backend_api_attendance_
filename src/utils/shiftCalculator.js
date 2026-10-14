/**
 * Utility functions for calculating shift duration, grace period, late arrival,
 * early departure, working hours, and overtime.
 */

const { DEFAULT_TIMEZONE, getLocalMinutesOfDay } = require("./datetime");

/**
 * Converts "HH:mm", a Date, or an ISO string to minutes from midnight.
 *
 * Shift start/end are wall-clock strings in the tenant's timezone, so a punch
 * instant has to be resolved in that same zone. Using the server's local clock
 * (the previous behaviour) made late/early minutes depend on where the process
 * happened to be deployed.
 */
const parseTimeToMinutes = (timeInput, timeZone = DEFAULT_TIMEZONE) => {
  if (!timeInput) return 0;
  if (typeof timeInput === "number") return timeInput;

  if (timeInput instanceof Date) {
    return getLocalMinutesOfDay(timeInput, timeZone);
  }

  if (typeof timeInput === "string") {
    // Standard "HH:mm" format (e.g. "09:00", "18:00") — already wall-clock.
    if (/^\d{1,2}:\d{2}/.test(timeInput) && !timeInput.includes("T")) {
      const [hours, minutes] = timeInput.split(":").map(Number);
      return (hours || 0) * 60 + (minutes || 0);
    }

    const d = new Date(timeInput);
    if (!isNaN(d.getTime())) {
      return getLocalMinutesOfDay(d, timeZone);
    }
  }

  return 0;
};

/**
 * Calculates scheduled duration of a shift in minutes.
 * Correctly handles overnight shifts (e.g. 22:00 to 06:00).
 */
const getScheduledDurationMinutes = (startTime, endTime) => {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (endMinutes >= startMinutes) {
    return endMinutes - startMinutes;
  }
  // Overnight shift crosses midnight (1440 mins = 24 hours)
  return 1440 - startMinutes + endMinutes;
};

/**
 * Calculates late minutes based on scheduled startTime, graceMinutes, and actual checkIn.
 * Returns 0 if check-in occurred within the allowed grace window.
 */
const calculateLateMinutes = (startTime, graceMinutes, checkInTime, timeZone = DEFAULT_TIMEZONE) => {
  if (!checkInTime) return 0;

  const scheduledStartMins = parseTimeToMinutes(startTime, timeZone);
  const actualCheckInMins = parseTimeToMinutes(checkInTime, timeZone);
  const grace = typeof graceMinutes === "number" ? graceMinutes : 10;

  let diff = actualCheckInMins - scheduledStartMins;

  // Handle overnight shift: shift started before midnight (e.g. 22:00 = 1320), check-in after midnight (00:15)
  if (scheduledStartMins > 1200 && actualCheckInMins < 300) {
    diff = 1440 - scheduledStartMins + actualCheckInMins;
  }

  // If checked in before or within grace period, late is 0
  if (diff <= grace) {
    return 0;
  }

  return Math.max(0, diff);
};

/**
 * Calculates early leaving minutes based on scheduled endTime and actual checkOut.
 *
 * For an overnight shift the scheduled end falls on the next calendar day, so a
 * raw minute-of-day comparison would flag every on-time checkout as hours early.
 */
const calculateEarlyMinutes = (endTime, checkOutTime, startTime = null, timeZone = DEFAULT_TIMEZONE) => {
  if (!checkOutTime) return 0;

  const scheduledEndMins = parseTimeToMinutes(endTime, timeZone);
  const actualCheckOutMins = parseTimeToMinutes(checkOutTime, timeZone);

  const scheduledStartMins = startTime !== null ? parseTimeToMinutes(startTime, timeZone) : null;
  const isOvernight = scheduledStartMins !== null && scheduledEndMins <= scheduledStartMins;

  if (isOvernight) {
    // Checkout in the early hours is the normal case; only a checkout that is
    // still on the starting day (i.e. before midnight) counts as leaving early.
    if (actualCheckOutMins > scheduledStartMins) {
      return 1440 - actualCheckOutMins + scheduledEndMins;
    }
    return Math.max(0, scheduledEndMins - actualCheckOutMins);
  }

  if (actualCheckOutMins < scheduledEndMins) {
    return scheduledEndMins - actualCheckOutMins;
  }

  return 0;
};

/**
 * Comprehensive Shift Metrics Engine
 * Evaluates attendance record against assigned shift rules.
 */
const evaluateAttendanceAgainstShift = (
  shift,
  checkInTime,
  checkOutTime,
  breakMinutes = 0,
  options = {}
) => {
  const { timeZone = DEFAULT_TIMEZONE, halfDayThresholdMinutes = null, lunchMinutes = 0 } = options;
  const scheduledMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);
  const configuredBreakMinutes = shift.breakIncluded === false ? 0 : Math.max(0, Number(shift.breakMinutes) || 0);
  const configuredLunchMinutes = shift.lunchIncluded === false ? 0 : Math.max(0, Number(shift.lunchMinutes) || 0);
  const scheduledWorkMinutes = Math.max(0, scheduledMinutes - configuredBreakMinutes - configuredLunchMinutes);
  const actualBreakMinutes = Math.max(0, parseInt(breakMinutes, 10) || 0);
  const actualLunchMinutes = Math.max(0, parseInt(lunchMinutes, 10) || 0);
  const totalPauseMinutes = actualBreakMinutes + actualLunchMinutes;
  const base = {
    scheduledMinutes, scheduledHours: (scheduledMinutes / 60).toFixed(1), scheduledFormatted: formatMinutes(scheduledMinutes),
    scheduledWorkMinutes, scheduledWorkHours: (scheduledWorkMinutes / 60).toFixed(1), scheduledWorkFormatted: formatMinutes(scheduledWorkMinutes),
    configuredBreakMinutes, configuredLunchMinutes, breakMinutes: actualBreakMinutes, breakFormatted: formatMinutes(actualBreakMinutes),
    lunchMinutes: actualLunchMinutes, lunchFormatted: formatMinutes(actualLunchMinutes), totalPauseMinutes, totalPauseFormatted: formatMinutes(totalPauseMinutes),
  };
  if (!checkInTime) return { ...base, workingMinutes: 0, workingHours: "0.0", workingFormatted: formatMinutes(0), lateMinutes: 0, earlyMinutes: 0, overtimeMinutes: 0, overtimeHours: "0.0", overtimeFormatted: formatMinutes(0), status: "ABSENT" };

  const lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime, timeZone);
  if (!checkOutTime) return { ...base, workingMinutes: 0, workingHours: "0.0", workingFormatted: formatMinutes(0), lateMinutes, originalLateMinutes: lateMinutes, lateFormatted: formatMinutes(lateMinutes), earlyMinutes: 0, earlyFormatted: formatMinutes(0), overtimeMinutes: 0, overtimeHours: "0.0", overtimeFormatted: formatMinutes(0), status: lateMinutes > 0 ? "LATE" : "PRESENT" };

  const inMs = new Date(checkInTime).getTime();
  const outMs = new Date(checkOutTime).getTime();
  let elapsedMinutes;
  if (!isNaN(inMs) && !isNaN(outMs) && outMs >= inMs) elapsedMinutes = Math.floor((outMs - inMs) / 60000);
  else {
    const inMins = parseTimeToMinutes(checkInTime, timeZone);
    const outMins = parseTimeToMinutes(checkOutTime, timeZone);
    elapsedMinutes = outMins >= inMins ? outMins - inMins : 1440 - inMins + outMins;
  }
  const workingMinutes = Math.max(0, elapsedMinutes - totalPauseMinutes);
  const earlyMinutes = calculateEarlyMinutes(shift.endTime, checkOutTime, shift.startTime, timeZone);
  const overtimeMinutes = Math.max(0, workingMinutes - scheduledWorkMinutes);
  const halfDayThreshold = Number.isFinite(halfDayThresholdMinutes) && halfDayThresholdMinutes > 0 ? halfDayThresholdMinutes : Math.floor(scheduledWorkMinutes / 2);
  const fullDayThresholdMinutes = scheduledWorkMinutes > 0 ? scheduledWorkMinutes : Math.min(480, scheduledMinutes || 480);
  const isCompletedFullDay = workingMinutes >= fullDayThresholdMinutes;
  const isLateWaived = lateMinutes > 0 && isCompletedFullDay;
  const effectiveLateMinutes = isLateWaived ? 0 : lateMinutes;
  const status = isCompletedFullDay ? "PRESENT" : workingMinutes < halfDayThreshold ? "HALF_DAY" : lateMinutes > 0 ? "LATE" : "PRESENT";
  return { ...base, workingMinutes, workingHours: (workingMinutes / 60).toFixed(1), workingFormatted: formatMinutes(workingMinutes), lateMinutes: effectiveLateMinutes, originalLateMinutes: lateMinutes, lateArrivalWaived: isLateWaived, isCompletedFullDay, lateFormatted: formatMinutes(effectiveLateMinutes), earlyMinutes, earlyFormatted: formatMinutes(earlyMinutes), overtimeMinutes, overtimeHours: (overtimeMinutes / 60).toFixed(1), overtimeFormatted: formatMinutes(overtimeMinutes), status };
};
const formatMinutes = (minutes) => {
  const total = Math.round(Number(minutes) || 0);
  if (total <= 0) return "0 min";
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0 && mins > 0) return `${hours} hr ${mins} min`;
  if (hours > 0) return `${hours} hr`;
  return `${mins} min`;
};

// Breaks are measured at second precision. A one-second break must never be
// rounded up and reported as a full minute.
const formatDurationSeconds = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins > 0 && secs > 0) return `${mins} min ${secs} sec`;
  if (mins > 0) return `${mins} min`;
  return `${secs} sec`;
};

module.exports = {
  parseTimeToMinutes,
  getScheduledDurationMinutes,
  calculateLateMinutes,
  calculateEarlyMinutes,
  evaluateAttendanceAgainstShift,
  formatMinutes,
  formatDurationSeconds,
};
