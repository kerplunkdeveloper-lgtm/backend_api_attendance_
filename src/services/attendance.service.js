const prisma = require("../config/database");
const { verifyGeofence } = require("../utils/geofence");
const {
  calculateLateMinutes,
  evaluateAttendanceAgainstShift,
  formatMinutes,
} = require("../utils/shiftCalculator");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a date to UTC midnight for unique daily attendance indexing.
 */
const getTodayDateOnly = (date = new Date()) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/**
 * Fetches org attendance policy, falling back to safe defaults if none configured.
 */
const getPolicy = async (organizationId) => {
  const policy = await prisma.attendancePolicy.findUnique({
    where: { organizationId },
  });
  return {
    workingDaysPerMonth: policy?.workingDaysPerMonth ?? 26,
    halfDayThresholdMinutes: policy?.halfDayThresholdMinutes ?? 240,
    maxLatesBeforeDeduction: policy?.maxLatesBeforeDeduction ?? 3,
    lateDeductionPercent: policy ? Number(policy.lateDeductionPercent) : 0.25,
    allowWfh: policy?.allowWfh ?? true,
    requireOtApproval: policy?.requireOtApproval ?? false,
    geofenceStrict: policy?.geofenceStrict ?? false, // Eligible from anywhere by default; admin can activate later
  };
};

/**
 * Finds employee record linked to user or by explicit employee ID within organization.
 */
const resolveEmployee = async (userId, employeeId, organizationId) => {
  let employee;
  if (employeeId) {
    employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { branch: true, shift: true, user: true },
    });
  } else if (userId) {
    employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
      include: { branch: true, shift: true, user: true },
    });
  }

  if (!employee) {
    const error = new Error("Active employee profile not found for this user");
    error.statusCode = 404;
    throw error;
  }

  return employee;
};

/**
 * Resolves the effective shift for an employee on a specific date.
 * Checks ShiftOverride first, then employee.shift, then org default.
 */
const resolveShift = async (employee, organizationId, date) => {
  const dateOnly = getTodayDateOnly(date);

  // 1. Check per-day shift override
  const override = await prisma.shiftOverride.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: dateOnly } },
    include: { shift: true },
  });
  if (override?.shift) return override.shift;

  // 2. Employee's assigned shift
  if (employee.shift) return employee.shift;

  // 3. Org default (oldest shift)
  const fallback = await prisma.shift.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  return fallback;
};

/**
 * Parses Shift.workingDays string ("1,2,3,4,5") into a Set of JS day-of-week numbers.
 * JS: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
 * Schema: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 0=Sun (same convention)
 */
const isWorkingDay = (shift, date) => {
  if (!shift?.workingDays) return true; // No shift = assume always working
  const schemaDay = date.getDay(); // JS day (0=Sun, 1=Mon...)
  const workingSet = new Set(shift.workingDays.split(",").map((d) => parseInt(d.trim())));
  return workingSet.has(schemaDay);
};

// ─────────────────────────────────────────────────────────────────────────────
// Clock-In (GPS / Geofence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard check-in with GPS geofence enforcement.
 * Now:
 *   - Uses resolveShift() to support ShiftOverride
 *   - Detects WEEK_OFF and auto-creates week-off record
 *   - Logs geofence bypass audit on AttendanceEvent
 */
const checkIn = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp, workMode = "OFFICE", note }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const checkInTime = timestamp ? new Date(timestamp) : new Date();
  const today = getTodayDateOnly(checkInTime);
  const policy = await getPolicy(organizationId);

  // ── Week-Off / Holiday / Leave Detection ──────────────────────────────────
  const shift = await resolveShift(employee, organizationId, checkInTime);
  const isOffDay = shift ? !isWorkingDay(shift, checkInTime) : false;

  const [holiday, approvedLeave] = await Promise.all([
    prisma.holiday.findFirst({
      where: {
        organizationId,
        date: today,
        isOptional: false,
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
    }),
    prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
    }),
  ]);

  const isHoliday = Boolean(holiday);
  const isOnLeave = Boolean(approvedLeave);
  const isOvertimeShift = isOffDay || isHoliday || isOnLeave;

  // ── Geofence Check ──────────────────────────────────────────────────────────
  let matchedBranch = employee.branch;
  let geofenceResult = null;
  let isBypassed = false;
  let bypassReason = null;

  if (matchedBranch) {
    geofenceResult = verifyGeofence(
      { latitude, longitude },
      { latitude: matchedBranch.latitude, longitude: matchedBranch.longitude, radiusMeters: matchedBranch.radiusMeters }
    );
    if (geofenceResult.bypassed) {
      isBypassed = true;
      bypassReason = "NO_BRANCH_GPS";
    }
  }

  // Multi-branch roaming fallback
  if (!geofenceResult || (!geofenceResult.isInside && !geofenceResult.bypassed)) {
    const allBranches = await prisma.branch.findMany({ where: { organizationId } });
    for (const b of allBranches) {
      const check = verifyGeofence(
        { latitude, longitude },
        { latitude: b.latitude, longitude: b.longitude, radiusMeters: b.radiusMeters }
      );
      if (check.isInside || check.bypassed) {
        matchedBranch = b;
        geofenceResult = check;
        if (check.bypassed) {
          isBypassed = true;
          bypassReason = "NO_BRANCH_GPS";
        }
        break;
      }
    }
  }

  if (!geofenceResult || (!geofenceResult.isInside && !geofenceResult.bypassed)) {
    const isSpecialWorkMode = ["WORK_FROM_HOME", "CLIENT_VISIT", "TRAVEL"].includes(workMode);
    if (policy.geofenceStrict && !isSpecialWorkMode) {
      const error = new Error(
        `Outside allowed branch boundary. Distance: ${geofenceResult?.distanceMeters || "N/A"}m, Max allowed: ${geofenceResult?.allowedRadiusMeters || 200}m`
      );
      error.statusCode = 400;
      error.details = geofenceResult;
      throw error;
    }
    // Non-strict or remote/field mode: allow and record as eligible
    isBypassed = true;
    bypassReason = workMode || "GEOFENCE_FLEXIBLE";
  }

  // ── Late Calculation ────────────────────────────────────────────────────────
  let lateMinutes = 0;
  let status = workMode === "WORK_FROM_HOME" ? "WORK_FROM_HOME" : "PRESENT";

  // If working on rest day/leave/holiday, late does not penalize the employee
  if (!isOvertimeShift && shift) {
    lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime);
    if (lateMinutes > 0 && status !== "WORK_FROM_HOME") status = "LATE";
  }

  // ── Duplicate Check ─────────────────────────────────────────────────────────
  const existingAttendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { events: true },
  });

  if (existingAttendance?.checkIn) {
    const timeStr = new Date(existingAttendance.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const error = new Error(`Already checked in for today at ${timeStr}`);
    error.statusCode = 400;
    error.attendance = existingAttendance;
    throw error;
  }

  const formattedNote = note || (workMode !== "OFFICE" ? workMode.replace(/_/g, " ") : null);

  // ── Persist ─────────────────────────────────────────────────────────────────
  const attendance = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: {
        checkIn: checkInTime,
        checkInLatitude: latitude ? String(latitude) : null,
        checkInLongitude: longitude ? String(longitude) : null,
        branchId: matchedBranch?.id || null,
        shiftId: shift?.id || null,
        status,
        lateMinutes,
        wfhNote: formattedNote,
      },
      create: {
        organizationId,
        employeeId: employee.id,
        branchId: matchedBranch?.id || null,
        shiftId: shift?.id || null,
        date: today,
        checkIn: checkInTime,
        checkInLatitude: latitude ? String(latitude) : null,
        checkInLongitude: longitude ? String(longitude) : null,
        status,
        lateMinutes,
        wfhNote: formattedNote,
      },
    });

    const event = await tx.attendanceEvent.create({
      data: {
        attendanceId: record.id,
        type: "CHECK_IN",
        timestamp: checkInTime,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
        accuracy: accuracy ? String(accuracy) : null,
        isBypassed,
        bypassReason: bypassReason || workMode || "FLEXIBLE_LOCATION",
      },
    });

    return { ...record, event };
  });

  let checkInMessage = status === "LATE" ? `Checked in late by ${lateMinutes} minutes` : "Checked in successfully on time";
  if (isOvertimeShift) {
    const reason = isOffDay ? "Weekend / Rest Day" : holiday ? `Holiday (${holiday.name})` : "Approved Leave Day";
    checkInMessage = `Checked in on ${reason} — all hours worked will be logged as Overtime (OT).`;
  }

  return {
    success: true,
    message: checkInMessage,
    attendance,
    geofence: geofenceResult,
    geofenceBypassed: isBypassed,
    bypassReason,
    branch: matchedBranch ? { id: matchedBranch.id, name: matchedBranch.name, radiusMeters: matchedBranch.radiusMeters } : null,
    shift: shift ? { id: shift.id, name: shift.name, startTime: shift.startTime, graceMinutes: shift.graceMinutes } : null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// WFH Check-In (No geofence, sets WORK_FROM_HOME status)
// ─────────────────────────────────────────────────────────────────────────────

const wfhCheckIn = async ({ userId, employeeId, organizationId, timestamp, wfhNote }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const checkInTime = timestamp ? new Date(timestamp) : new Date();
  const today = getTodayDateOnly(checkInTime);
  const policy = await getPolicy(organizationId);

  if (!policy.allowWfh) {
    const error = new Error("Work From Home check-in is not enabled for this organization.");
    error.statusCode = 403;
    throw error;
  }

  const shift = await resolveShift(employee, organizationId, checkInTime);
  const isOffDay = shift ? !isWorkingDay(shift, checkInTime) : false;

  const [holiday, approvedLeave] = await Promise.all([
    prisma.holiday.findFirst({
      where: {
        organizationId,
        date: today,
        isOptional: false,
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
    }),
    prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
    }),
  ]);

  const isHoliday = Boolean(holiday);
  const isOnLeave = Boolean(approvedLeave);
  const isOvertimeShift = isOffDay || isHoliday || isOnLeave;

  // Duplicate check
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
  });
  if (existing?.checkIn) {
    const error = new Error("Already checked in for today.");
    error.statusCode = 400;
    throw error;
  }

  let lateMinutes = 0;
  if (!isOvertimeShift && shift) {
    lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime);
  }

  const attendance = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: {
        checkIn: checkInTime,
        shiftId: shift?.id || null,
        status: "WORK_FROM_HOME",
        lateMinutes,
        wfhNote: wfhNote || null,
      },
      create: {
        organizationId,
        employeeId: employee.id,
        shiftId: shift?.id || null,
        date: today,
        checkIn: checkInTime,
        status: "WORK_FROM_HOME",
        lateMinutes,
        wfhNote: wfhNote || null,
      },
    });

    await tx.attendanceEvent.create({
      data: {
        attendanceId: record.id,
        type: "CHECK_IN",
        timestamp: checkInTime,
        isBypassed: true,
        bypassReason: "WFH",
      },
    });

    return record;
  });

  let wfhMessage = lateMinutes > 0 ? `WFH check-in recorded. Late by ${lateMinutes} minutes.` : "WFH check-in recorded successfully.";
  if (isOvertimeShift) {
    const reason = isOffDay ? "Weekend / Rest Day" : holiday ? `Holiday (${holiday.name})` : "Approved Leave Day";
    wfhMessage = `WFH check-in recorded on ${reason} — all hours worked will be logged as Overtime (OT).`;
  }

  return {
    success: true,
    message: wfhMessage,
    attendance,
    shift: shift ? { id: shift.id, name: shift.name, startTime: shift.startTime } : null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Clock-Out
// ─────────────────────────────────────────────────────────────────────────────

const checkOut = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp, workMode, note }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const checkOutTime = timestamp ? new Date(timestamp) : new Date();
  const today = getTodayDateOnly(checkOutTime);

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: {
      shift: true,
      events: { orderBy: { timestamp: "desc" } },
    },
  });

  if (!attendance || !attendance.checkIn) {
    const error = new Error("No check-in record found for today. You must check in before checking out.");
    error.statusCode = 400;
    throw error;
  }

  if (attendance.checkOut) {
    const timeStr = new Date(attendance.checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const error = new Error(`Already checked out for today at ${timeStr}`);
    error.statusCode = 400;
    error.attendance = attendance;
    throw error;
  }

  // Resolve shift with override support
  let shift = attendance.shift || (await resolveShift(employee, organizationId, checkOutTime));
  const isOffDay = shift ? !isWorkingDay(shift, checkOutTime) : false;

  const [holiday, approvedLeave] = await Promise.all([
    prisma.holiday.findFirst({
      where: {
        organizationId,
        date: today,
        isOptional: false,
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
    }),
    prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        startDate: { lte: today },
        endDate: { gte: today },
      },
    }),
  ]);

  const isNonWorkingDay = isOffDay || Boolean(holiday) || Boolean(approvedLeave);

  // Auto-close unclosed break
  let autoClosedBreakDuration = 0;
  const lastEvent = attendance.events?.[0];
  const isOnActiveBreak = lastEvent && lastEvent.type === "BREAK_START";
  if (isOnActiveBreak) {
    autoClosedBreakDuration = Math.max(
      1,
      Math.floor((checkOutTime.getTime() - new Date(lastEvent.timestamp).getTime()) / 60000)
    );
  }

  const totalBreakMinutes = (attendance.breakMinutes || 0) + autoClosedBreakDuration;
  const elapsedMinutes = Math.max(
    0,
    Math.floor((checkOutTime.getTime() - new Date(attendance.checkIn).getTime()) / 60000)
  );

  const calculatedWorkingMinutes = Math.max(0, elapsedMinutes - totalBreakMinutes);

  let metrics;
  if (isNonWorkingDay) {
    // 100% of working time on a rest day / holiday / leave day is logged as Overtime (OT)
    metrics = {
      scheduledMinutes: 0,
      scheduledHours: "0.0",
      scheduledFormatted: "0m (Rest Day/Leave)",
      workingMinutes: calculatedWorkingMinutes,
      workingHours: (calculatedWorkingMinutes / 60).toFixed(1),
      workingFormatted: formatMinutes(calculatedWorkingMinutes),
      breakMinutes: totalBreakMinutes,
      breakFormatted: formatMinutes(totalBreakMinutes),
      lateMinutes: 0,
      lateFormatted: "0m",
      earlyMinutes: 0,
      earlyFormatted: "0m",
      overtimeMinutes: calculatedWorkingMinutes,
      overtimeHours: (calculatedWorkingMinutes / 60).toFixed(1),
      overtimeFormatted: formatMinutes(calculatedWorkingMinutes),
      status: attendance.status === "WORK_FROM_HOME" ? "WORK_FROM_HOME" : "PRESENT",
      isNonWorkingDay: true,
    };
  } else if (shift) {
    metrics = evaluateAttendanceAgainstShift(shift, attendance.checkIn, checkOutTime, totalBreakMinutes);
  } else {
    metrics = {
      scheduledMinutes: 480,
      workingMinutes: calculatedWorkingMinutes,
      workingHours: (calculatedWorkingMinutes / 60).toFixed(1),
      workingFormatted: formatMinutes(calculatedWorkingMinutes),
      breakMinutes: totalBreakMinutes,
      breakFormatted: formatMinutes(totalBreakMinutes),
      lateMinutes: attendance.lateMinutes || 0,
      lateFormatted: formatMinutes(attendance.lateMinutes || 0),
      earlyMinutes: 0,
      earlyFormatted: "0m",
      overtimeMinutes: Math.max(0, calculatedWorkingMinutes - 480),
      overtimeHours: (Math.max(0, calculatedWorkingMinutes - 480) / 60).toFixed(1),
      overtimeFormatted: formatMinutes(Math.max(0, calculatedWorkingMinutes - 480)),
      status: attendance.status,
    };
  }

  // Preserve WFH status through checkout
  if (attendance.status === "WORK_FROM_HOME") {
    metrics.status = "WORK_FROM_HOME";
  }

  const updatedAttendance = await prisma.$transaction(async (tx) => {
    if (isOnActiveBreak) {
      await tx.attendanceEvent.create({
        data: {
          attendanceId: attendance.id,
          type: "BREAK_END",
          timestamp: checkOutTime,
          latitude: latitude ? String(latitude) : null,
          longitude: longitude ? String(longitude) : null,
          isBypassed: false,
        },
      });
    }

    const updated = await tx.attendance.update({
      where: { id: attendance.id },
      data: {
        checkOut: checkOutTime,
        checkOutLatitude: latitude ? String(latitude) : null,
        checkOutLongitude: longitude ? String(longitude) : null,
        workingMinutes: metrics.workingMinutes,
        breakMinutes: totalBreakMinutes,
        lateMinutes: metrics.lateMinutes !== undefined ? metrics.lateMinutes : (attendance.lateMinutes || 0),
        earlyMinutes: metrics.earlyMinutes || 0,
        overtimeMinutes: metrics.overtimeMinutes || 0,
        status: metrics.status || attendance.status,
      },
    });

    await tx.attendanceEvent.create({
      data: {
        attendanceId: attendance.id,
        type: "CHECK_OUT",
        timestamp: checkOutTime,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
        accuracy: accuracy ? String(accuracy) : null,
        isBypassed: true,
        bypassReason: workMode || "GEOFENCE_FLEXIBLE",
      },
    });

    return updated;
  });

  const checkoutMessage = metrics.isNonWorkingDay
    ? `Checked out. ${metrics.workingFormatted} logged as Overtime (OT worked on rest day/leave).`
    : metrics.lateArrivalWaived
    ? `Checked out. ${metrics.workingFormatted} logged (Full shift completed — late arrival waived).`
    : `Checked out. Working: ${metrics.workingFormatted}, Breaks: ${metrics.breakFormatted || "0m"}`;

  return {
    success: true,
    message: checkoutMessage,
    attendance: updatedAttendance,
    metrics: {
      elapsedMinutes,
      elapsedFormatted: formatMinutes(elapsedMinutes),
      breakMinutes: totalBreakMinutes,
      breakFormatted: formatMinutes(totalBreakMinutes),
      workingMinutes: metrics.workingMinutes,
      workingHours: (metrics.workingMinutes / 60).toFixed(1),
      workingFormatted: metrics.workingFormatted,
      earlyMinutes: metrics.earlyMinutes || 0,
      earlyFormatted: metrics.earlyFormatted,
      overtimeMinutes: metrics.overtimeMinutes || 0,
      overtimeHours: ((metrics.overtimeMinutes || 0) / 60).toFixed(1),
      overtimeFormatted: metrics.overtimeFormatted,
      status: metrics.status || updatedAttendance.status,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Break Start / End
// ─────────────────────────────────────────────────────────────────────────────

const startBreak = async ({ userId, employeeId, organizationId, latitude, longitude }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const today = getTodayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { events: { orderBy: { timestamp: "desc" } } },
  });

  if (!attendance?.checkIn) {
    const error = new Error("You must check in before taking a break");
    error.statusCode = 400;
    throw error;
  }
  if (attendance.checkOut) {
    const error = new Error("Cannot take a break after checking out");
    error.statusCode = 400;
    throw error;
  }

  const lastEvent = attendance.events[0];
  if (lastEvent?.type === "BREAK_START") {
    const error = new Error("You are already on a break");
    error.statusCode = 400;
    throw error;
  }

  const breakStartTime = new Date();
  const event = await prisma.attendanceEvent.create({
    data: {
      attendanceId: attendance.id,
      type: "BREAK_START",
      timestamp: breakStartTime,
      latitude: latitude ? String(latitude) : null,
      longitude: longitude ? String(longitude) : null,
      isBypassed: false,
    },
  });

  return {
    success: true,
    message: `Break started at ${breakStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    event,
    attendance,
  };
};

const endBreak = async ({ userId, employeeId, organizationId, latitude, longitude }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const today = getTodayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { events: { orderBy: { timestamp: "desc" } } },
  });

  if (!attendance?.checkIn) {
    const error = new Error("No active attendance record found for today");
    error.statusCode = 400;
    throw error;
  }

  const lastBreakStart = attendance.events.find((e) => e.type === "BREAK_START");
  const lastBreakEnd = attendance.events.find((e) => e.type === "BREAK_END");

  if (!lastBreakStart || (lastBreakEnd && new Date(lastBreakEnd.timestamp) >= new Date(lastBreakStart.timestamp))) {
    const error = new Error("No active break to end");
    error.statusCode = 400;
    throw error;
  }

  const breakEndTime = new Date();
  const durationMinutes = Math.max(
    1,
    Math.floor((breakEndTime.getTime() - new Date(lastBreakStart.timestamp).getTime()) / 60000)
  );

  const updatedAttendance = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.update({
      where: { id: attendance.id },
      data: { breakMinutes: (attendance.breakMinutes || 0) + durationMinutes },
    });

    const event = await tx.attendanceEvent.create({
      data: {
        attendanceId: attendance.id,
        type: "BREAK_END",
        timestamp: breakEndTime,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
        isBypassed: false,
      },
    });

    return { ...record, event };
  });

  return {
    success: true,
    message: `Break ended. Duration: ${durationMinutes} minutes`,
    durationMinutes,
    totalBreakMinutes: updatedAttendance.breakMinutes,
    attendance: updatedAttendance,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Break Detail (structured break pairs from events)
// ─────────────────────────────────────────────────────────────────────────────

const getBreakDetails = async ({ userId, employeeId, organizationId, attendanceId }) => {
  let attendance;

  if (attendanceId) {
    attendance = await prisma.attendance.findFirst({
      where: { id: attendanceId, organizationId },
      include: { events: { orderBy: { timestamp: "asc" } } },
    });
  } else {
    const employee = await resolveEmployee(userId, employeeId, organizationId);
    const today = getTodayDateOnly();
    attendance = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      include: { events: { orderBy: { timestamp: "asc" } } },
    });
  }

  if (!attendance) {
    const error = new Error("Attendance record not found");
    error.statusCode = 404;
    throw error;
  }

  // Pair BREAK_START with next BREAK_END
  const breaks = [];
  const events = attendance.events;
  let openBreak = null;

  for (const event of events) {
    if (event.type === "BREAK_START") {
      openBreak = event;
    } else if (event.type === "BREAK_END" && openBreak) {
      const durationMinutes = Math.floor(
        (new Date(event.timestamp).getTime() - new Date(openBreak.timestamp).getTime()) / 60000
      );
      breaks.push({
        startTime: openBreak.timestamp,
        endTime: event.timestamp,
        durationMinutes,
        durationFormatted: formatMinutes(durationMinutes),
      });
      openBreak = null;
    }
  }

  // Unclosed break (employee still on break)
  if (openBreak) {
    const durationMinutes = Math.floor((Date.now() - new Date(openBreak.timestamp).getTime()) / 60000);
    breaks.push({
      startTime: openBreak.timestamp,
      endTime: null,
      durationMinutes,
      durationFormatted: formatMinutes(durationMinutes),
      isActive: true,
    });
  }

  return {
    success: true,
    attendanceId: attendance.id,
    totalBreakMinutes: attendance.breakMinutes,
    totalBreakFormatted: formatMinutes(attendance.breakMinutes),
    breakCount: breaks.length,
    breaks,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin Direct Mark (no GPS needed, bypasses all checks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allows Admin/Manager to directly set attendance status for any employee.
 * Also supports marking WEEK_OFF, HOLIDAY, ON_LEAVE without going through
 * the correction request flow.
 */
const adminMarkAttendance = async ({ adminUserId, organizationId, employeeId, date, status, checkIn, checkOut, reason }) => {
  const validStatuses = ["PRESENT", "ABSENT", "LATE", "HALF_DAY", "ON_LEAVE", "HOLIDAY", "WEEK_OFF", "WORK_FROM_HOME"];
  if (!validStatuses.includes(status)) {
    const error = new Error(`Invalid status. Allowed: ${validStatuses.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: { shift: true },
  });
  if (!employee) {
    const error = new Error("Employee not found in this organization");
    error.statusCode = 404;
    throw error;
  }

  const targetDate = getTodayDateOnly(new Date(date));
  const shift = await resolveShift(employee, organizationId, new Date(date));

  let workingMinutes = 0;
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let overtimeMinutes = 0;

  if (checkIn && checkOut && shift) {
    const metrics = evaluateAttendanceAgainstShift(shift, new Date(checkIn), new Date(checkOut));
    workingMinutes = metrics.workingMinutes;
    lateMinutes = metrics.lateMinutes;
    earlyMinutes = metrics.earlyMinutes;
    overtimeMinutes = metrics.overtimeMinutes;
  }

  const attendance = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: targetDate } },
    update: {
      status,
      checkIn: checkIn ? new Date(checkIn) : undefined,
      checkOut: checkOut ? new Date(checkOut) : undefined,
      workingMinutes,
      lateMinutes,
      earlyMinutes,
      overtimeMinutes,
    },
    create: {
      organizationId,
      employeeId,
      branchId: employee.branchId || null,
      shiftId: shift?.id || null,
      date: targetDate,
      checkIn: checkIn ? new Date(checkIn) : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      status,
      workingMinutes,
      lateMinutes,
      earlyMinutes,
      overtimeMinutes,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId: adminUserId,
      action: "UPDATE",
      entity: "ATTENDANCE",
      entityId: attendance.id,
      details: `Admin manually marked attendance as ${status} for employee ${employeeId} on ${date}. Reason: ${reason || "N/A"}`,
    },
  });

  return {
    success: true,
    message: `Attendance marked as ${status} for ${employee.firstName} ${employee.lastName || ""}`.trim(),
    attendance,
    markedBy: adminUserId,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

const getTodayStatus = async (userId, organizationId) => {
  const employee = await prisma.employee.findFirst({
    where: { userId, organizationId },
    include: { branch: true, shift: true },
  });

  if (!employee) {
    return {
      success: true,
      hasEmployeeProfile: false,
      hasCheckedIn: false,
      hasCheckedOut: false,
      clockedIn: false,
      isOnBreak: false,
      isWorkFromHome: false,
      attendance: null,
    };
  }

  const today = getTodayDateOnly();
  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: {
      shift: true,
      branch: true,
      events: { orderBy: { timestamp: "desc" } },
    },
  });

  const hasCheckedIn = Boolean(attendance?.checkIn);
  const hasCheckedOut = Boolean(attendance?.checkOut);
  const clockedIn = hasCheckedIn && !hasCheckedOut;
  const isOnBreak = Boolean(clockedIn && attendance?.events?.[0]?.type === "BREAK_START");
  const isWorkFromHome = Boolean(
    attendance?.status === "WORK_FROM_HOME" ||
    (attendance?.wfhNote && attendance.wfhNote.toLowerCase().includes("home"))
  );

  return {
    success: true,
    hasEmployeeProfile: true,
    hasCheckedIn,
    hasCheckedOut,
    clockedIn,
    isOnBreak,
    isWorkFromHome,
    totalBreakMinutes: attendance?.breakMinutes || 0,
    employee: {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
      employeeCode: employee.employeeCode,
      branch: employee.branch,
      shift: employee.shift,
    },
    attendance,
  };
};

const getMyAttendance = async (userId, organizationId, { limit = 30, page = 1 }) => {
  const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
  if (!employee) return { records: [], total: 0 };

  const take = parseInt(limit) || 30;
  const skip = ((parseInt(page) || 1) - 1) * take;

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where: { employeeId: employee.id, organizationId },
      include: {
        branch: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        events: true,
      },
      orderBy: { date: "desc" },
      take,
      skip,
    }),
    prisma.attendance.count({ where: { employeeId: employee.id, organizationId } }),
  ]);

  return { records, total, page: parseInt(page), totalPages: Math.ceil(total / take) };
};

const getAllAttendance = async (organizationId, query = {}) => {
  const { date, employeeId, branchId, status, page = 1, limit = 50 } = query;

  const where = { organizationId };
  if (date) where.date = getTodayDateOnly(new Date(date));
  if (employeeId) where.employeeId = employeeId;
  if (branchId && branchId !== "ALL" && branchId !== "") where.branchId = branchId;
  if (status && status !== "ALL") where.status = status;

  const take = parseInt(limit) || 50;
  const skip = ((parseInt(page) || 1) - 1) * take;

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } } },
        branch: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        events: true,
      },
      orderBy: { date: "desc" },
      take,
      skip,
    }),
    prisma.attendance.count({ where }),
  ]);

  return { records, total, page: parseInt(page), totalPages: Math.ceil(total / take) };
};

const getAttendanceSummary = async (organizationId, targetDate = new Date(), branchId = null) => {
  const date = getTodayDateOnly(targetDate);

  const empWhere = { organizationId, status: "ACTIVE" };
  const attWhere = { organizationId, date };

  if (branchId && branchId !== "ALL" && branchId !== "") {
    empWhere.branchId = branchId;
    attWhere.OR = [{ branchId }, { employee: { branchId } }];
  }

  const holidayWhere = { organizationId, date, isOptional: false };
  if (branchId && branchId !== "ALL" && branchId !== "") {
    holidayWhere.OR = [{ branchId: null }, { branchId }];
  }

  const [totalEmployees, todayAttendances, todayHoliday] = await Promise.all([
    prisma.employee.count({ where: empWhere }),
    prisma.attendance.findMany({ where: attWhere, select: { status: true, checkIn: true, checkOut: true } }),
    prisma.holiday.findFirst({ where: holidayWhere }),
  ]);

  let present = 0, late = 0, halfDay = 0, onLeave = 0, holidayCount = 0, wfh = 0, weekOff = 0, currentlyClockedIn = 0;

  todayAttendances.forEach((att) => {
    if (att.status === "PRESENT") present++;
    if (att.status === "LATE") late++;
    if (att.status === "HALF_DAY") halfDay++;
    if (att.status === "ON_LEAVE") onLeave++;
    if (att.status === "HOLIDAY") holidayCount++;
    if (att.status === "WORK_FROM_HOME") wfh++;
    if (att.status === "WEEK_OFF") weekOff++;
    if (att.checkIn && !att.checkOut) currentlyClockedIn++;
  });

  const isTodayHoliday = Boolean(todayHoliday);
  const totalMarked = todayAttendances.length;
  const absent = isTodayHoliday ? 0 : Math.max(0, totalEmployees - totalMarked);
  if (isTodayHoliday && holidayCount === 0) {
    holidayCount = Math.max(0, totalEmployees - (present + late + halfDay + onLeave + wfh + weekOff));
  }

  return {
    date: date.toISOString().split("T")[0],
    totalEmployees,
    present,
    late,
    halfDay,
    onLeave,
    wfh,
    weekOff,
    holiday: holidayCount,
    absent,
    isHoliday: isTodayHoliday,
    holidayName: todayHoliday ? todayHoliday.name : null,
    currentlyClockedIn,
    attendanceRate: totalEmployees > 0 ? Math.round(((present + late + wfh) / totalEmployees) * 100) : 0,
  };
};

const getAttendanceHistory = async ({ userId, organizationId, role, employeeId, from, to, status, page = 1, limit = 20 }) => {
  const where = { organizationId };

  if (role === "EMPLOYEE") {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return { success: true, total: 0, page: 1, limit: parseInt(limit) || 20, totalPages: 0, records: [] };
    where.employeeId = employee.id;
  } else if (employeeId) {
    where.employeeId = employeeId;
  }

  if (from || to) {
    where.date = {};
    if (from) where.date.gte = getTodayDateOnly(new Date(from));
    if (to) where.date.lte = getTodayDateOnly(new Date(to));
  }

  if (status && status !== "ALL") where.status = status;

  const take = Math.max(1, parseInt(limit) || 20);
  const curPage = Math.max(1, parseInt(page) || 1);
  const skip = (curPage - 1) * take;

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true,
            department: { select: { id: true, name: true } },
            user: { select: { email: true } },
          },
        },
        branch: { select: { id: true, name: true, radiusMeters: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, graceMinutes: true } },
        events: { orderBy: { timestamp: "asc" } },
      },
      orderBy: { date: "desc" },
      take,
      skip,
    }),
    prisma.attendance.count({ where }),
  ]);

  return { success: true, page: curPage, limit: take, total, totalPages: Math.ceil(total / take) || 1, records };
};

// ─────────────────────────────────────────────────────────────────────────────
// Offline Sync — Batch process locally-queued punches from device storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Accepts an array of offline punch events and processes each one in order.
 * Each punch has a `type` (CHECK_IN | CHECK_OUT | BREAK_START | BREAK_END | WFH_CHECK_IN)
 * and an original `timestamp` recorded on the device at punch time.
 *
 * Key behaviours:
 *  - Uses original device timestamp (not server time) so attendance records are accurate.
 *  - Skips already-processed punches gracefully (idempotent).
 *  - Returns per-item success/skip/error results so frontend can clear only synced items.
 *
 * @param {string} userId
 * @param {string} organizationId
 * @param {Array<{id: string, type: string, timestamp: string, latitude?: number, longitude?: number, accuracy?: number, wfhNote?: string}>} punches
 */
const syncOfflinePunches = async (userId, organizationId, punches) => {
  if (!Array.isArray(punches) || punches.length === 0) {
    return { success: true, synced: 0, skipped: 0, failed: 0, results: [] };
  }

  // Sort punches chronologically so check-in always comes before check-out
  const sorted = [...punches].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const results = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const punch of sorted) {
    const { id: localId, type, timestamp, latitude, longitude, accuracy, wfhNote } = punch;

    try {
      let result;

      switch (type) {
        case "CHECK_IN":
          result = await checkIn({ userId, organizationId, latitude, longitude, accuracy, timestamp });
          break;

        case "WFH_CHECK_IN":
          result = await wfhCheckIn({ userId, organizationId, timestamp, wfhNote });
          break;

        case "CHECK_OUT":
          result = await checkOut({ userId, organizationId, latitude, longitude, accuracy, timestamp });
          break;

        case "BREAK_START":
          result = await startBreak({ userId, organizationId, latitude, longitude });
          break;

        case "BREAK_END":
          result = await endBreak({ userId, organizationId, latitude, longitude });
          break;

        default:
          results.push({ localId, status: "FAILED", reason: `Unknown punch type: ${type}` });
          failed++;
          continue;
      }

      results.push({ localId, status: "SYNCED", serverResult: result });
      synced++;
    } catch (err) {
      // Already checked-in / already checked-out = considered "skipped" not "failed"
      const isAlreadyProcessed =
        err.statusCode === 400 &&
        (err.message.includes("Already checked in") || err.message.includes("Already checked out"));

      if (isAlreadyProcessed) {
        results.push({ localId, status: "SKIPPED", reason: err.message });
        skipped++;
      } else {
        results.push({ localId, status: "FAILED", reason: err.message });
        failed++;
      }
    }
  }

  return {
    success: true,
    message: `Sync complete: ${synced} synced, ${skipped} skipped (duplicates), ${failed} failed.`,
    synced,
    skipped,
    failed,
    results,
  };
};

/**
 * Exported for use by other services (leave, payroll, notification)
 */
module.exports = {
  checkIn,
  wfhCheckIn,
  checkOut,
  startBreak,
  endBreak,
  getBreakDetails,
  adminMarkAttendance,
  getTodayStatus,
  getMyAttendance,
  getAllAttendance,
  getAttendanceHistory,
  getAttendanceSummary,
  getTodayDateOnly,
  getPolicy,
  syncOfflinePunches,
};
