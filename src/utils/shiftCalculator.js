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
  const { timeZone = DEFAULT_TIMEZONE, halfDayThresholdMinutes = null } = options;
  const scheduledMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);

  let workingMinutes = 0;
  let overtimeMinutes = 0;
  let earlyMinutes = 0;
  let lateMinutes = 0;
  let status = "PRESENT";

  if (checkInTime) {
    lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime, timeZone);
    if (lateMinutes > 0) {
      status = "LATE";
    }
  } else {
    return {
      scheduledMinutes,
      workingMinutes: 0,
      breakMinutes: 0,
      lateMinutes: 0,
      earlyMinutes: 0,
      overtimeMinutes: 0,
      status: "ABSENT",
    };
  }

  if (checkInTime && checkOutTime) {
    // If both are full Date objects or timestamps
    const inMs = new Date(checkInTime).getTime();
    const outMs = new Date(checkOutTime).getTime();
    let elapsedMinutes = 0;

    if (!isNaN(inMs) && !isNaN(outMs) && outMs >= inMs) {
      elapsedMinutes = Math.floor((outMs - inMs) / (1000 * 60));
    } else {
      // If passed as "HH:mm" time strings
      const inMins = parseTimeToMinutes(checkInTime, timeZone);
      const outMins = parseTimeToMinutes(checkOutTime, timeZone);
      elapsedMinutes = outMins >= inMins ? outMins - inMins : 1440 - inMins + outMins;
    }

    // Deduct break duration from total elapsed working minutes
    const validBreak = Math.max(0, parseInt(breakMinutes) || 0);
    workingMinutes = Math.max(0, elapsedMinutes - validBreak);

    earlyMinutes = calculateEarlyMinutes(shift.endTime, checkOutTime, shift.startTime, timeZone);

    if (workingMinutes > scheduledMinutes) {
      overtimeMinutes = workingMinutes - scheduledMinutes;
    }

    // Half-day threshold comes from org policy when configured; otherwise it
    // falls back to half the scheduled shift.
    const halfDayThreshold =
      Number.isFinite(halfDayThresholdMinutes) && halfDayThresholdMinutes > 0
        ? halfDayThresholdMinutes
        : Math.floor(scheduledMinutes / 2);

    // 8-Hour Full-Day Completion Policy:
    // When employee checks out, if total working time completes 8 hours (480 mins) or scheduled shift duration,
    // they have completed their full work obligation -> Late arrival is waived and status is marked as PRESENT.
    const fullDayThresholdMinutes = Math.min(480, scheduledMinutes > 0 ? scheduledMinutes : 480);
    const isCompletedFullDay = workingMinutes >= fullDayThresholdMinutes;
    const isLateWaived = lateMinutes > 0 && isCompletedFullDay;

    let effectiveLateMinutes = lateMinutes;

    if (isCompletedFullDay) {
      status = "PRESENT";
      effectiveLateMinutes = 0; // Late waived because full 8 hours completed
    } else if (workingMinutes < halfDayThreshold) {
      status = "HALF_DAY";
    } else if (lateMinutes > 0) {
      status = "LATE";
    } else {
      status = "PRESENT";
    }

    return {
      scheduledMinutes,
      scheduledHours: (scheduledMinutes / 60).toFixed(1),
      scheduledFormatted: formatMinutes(scheduledMinutes),
      workingMinutes,
      workingHours: (workingMinutes / 60).toFixed(1),
      workingFormatted: formatMinutes(workingMinutes),
      breakMinutes: Math.max(0, parseInt(breakMinutes) || 0),
      breakFormatted: formatMinutes(Math.max(0, parseInt(breakMinutes) || 0)),
      lateMinutes: effectiveLateMinutes,
      originalLateMinutes: lateMinutes,
      lateArrivalWaived: isLateWaived,
      isCompletedFullDay,
      lateFormatted: formatMinutes(effectiveLateMinutes),
      earlyMinutes,
      earlyFormatted: formatMinutes(earlyMinutes),
      overtimeMinutes,
      overtimeHours: (overtimeMinutes / 60).toFixed(1),
      overtimeFormatted: formatMinutes(overtimeMinutes),
      status,
    };
  }

  return {
    scheduledMinutes,
    scheduledHours: (scheduledMinutes / 60).toFixed(1),
    scheduledFormatted: formatMinutes(scheduledMinutes),
    workingMinutes,
    workingHours: (workingMinutes / 60).toFixed(1),
    workingFormatted: formatMinutes(workingMinutes),
    breakMinutes: Math.max(0, parseInt(breakMinutes) || 0),
    breakFormatted: formatMinutes(Math.max(0, parseInt(breakMinutes) || 0)),
    lateMinutes,
    originalLateMinutes: lateMinutes,
    lateArrivalWaived: false,
    isCompletedFullDay: false,
    lateFormatted: formatMinutes(lateMinutes),
    earlyMinutes,
    earlyFormatted: formatMinutes(earlyMinutes),
    overtimeMinutes,
    overtimeHours: (overtimeMinutes / 60).toFixed(1),
    overtimeFormatted: formatMinutes(overtimeMinutes),
    status,
  };
};

/**
 * Formats minutes into human-readable format like "9h 10m", "45m", "8h".
 */
const formatMinutes = (minutes) => {
  if (!minutes || minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
};

module.exports = {
  parseTimeToMinutes,
  getScheduledDurationMinutes,
  calculateLateMinutes,
  calculateEarlyMinutes,
  evaluateAttendanceAgainstShift,
  formatMinutes,
};
