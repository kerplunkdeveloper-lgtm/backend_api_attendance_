/**
 * Utility functions for calculating shift duration, grace period, late arrival,
 * early departure, working hours, and overtime.
 */

// Helper to convert "HH:mm" or Date or ISO string to minutes from 00:00
const parseTimeToMinutes = (timeInput) => {
  if (!timeInput) return 0;
  if (typeof timeInput === "number") return timeInput;

  if (timeInput instanceof Date) {
    return timeInput.getHours() * 60 + timeInput.getMinutes();
  }

  if (typeof timeInput === "string") {
    // Standard "HH:mm" format (e.g. "09:00", "18:00")
    if (/^\d{1,2}:\d{2}/.test(timeInput) && !timeInput.includes("T")) {
      const [hours, minutes] = timeInput.split(":").map(Number);
      return (hours || 0) * 60 + (minutes || 0);
    }

    // ISO timestamp string
    const d = new Date(timeInput);
    if (!isNaN(d.getTime())) {
      // If ISO string has UTC indicator 'Z', get UTC hours to avoid timezone shift
      if (timeInput.endsWith("Z")) {
        return d.getUTCHours() * 60 + d.getUTCMinutes();
      }
      return d.getHours() * 60 + d.getMinutes();
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
const calculateLateMinutes = (startTime, graceMinutes, checkInTime) => {
  if (!checkInTime) return 0;

  const scheduledStartMins = parseTimeToMinutes(startTime);
  const actualCheckInMins = parseTimeToMinutes(checkInTime);
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
 */
const calculateEarlyMinutes = (endTime, checkOutTime) => {
  if (!checkOutTime) return 0;

  const scheduledEndMins = parseTimeToMinutes(endTime);
  const actualCheckOutMins = parseTimeToMinutes(checkOutTime);

  if (actualCheckOutMins < scheduledEndMins) {
    return scheduledEndMins - actualCheckOutMins;
  }

  return 0;
};

/**
 * Comprehensive Shift Metrics Engine
 * Evaluates attendance record against assigned shift rules.
 */
const evaluateAttendanceAgainstShift = (shift, checkInTime, checkOutTime, breakMinutes = 0) => {
  const scheduledMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);

  let workingMinutes = 0;
  let overtimeMinutes = 0;
  let earlyMinutes = 0;
  let lateMinutes = 0;
  let status = "PRESENT";

  if (checkInTime) {
    lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime);
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
      const inMins = parseTimeToMinutes(checkInTime);
      const outMins = parseTimeToMinutes(checkOutTime);
      elapsedMinutes = outMins >= inMins ? outMins - inMins : 1440 - inMins + outMins;
    }

    // Deduct break duration from total elapsed working minutes
    const validBreak = Math.max(0, parseInt(breakMinutes) || 0);
    workingMinutes = Math.max(0, elapsedMinutes - validBreak);

    earlyMinutes = calculateEarlyMinutes(shift.endTime, checkOutTime);

    if (workingMinutes > scheduledMinutes) {
      overtimeMinutes = workingMinutes - scheduledMinutes;
    }

    // Half-day check: worked less than 50% of scheduled shift
    const halfDayThreshold = Math.floor(scheduledMinutes / 2);

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
