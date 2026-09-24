const prisma = require("../config/database");
const { verifyGeofence } = require("../utils/geofence");
const {
  calculateLateMinutes,
  evaluateAttendanceAgainstShift,
  formatMinutes,
} = require("../utils/shiftCalculator");
const {
  DEFAULT_TIMEZONE,
  getLocalDateOnly,
  getLocalDayOfWeek,
  isOvernightShift,
} = require("../utils/datetime");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a date to UTC midnight for unique daily attendance indexing.
 *
 * Kept for callers that already hold a date-only value. Anything deriving a
 * calendar date from a punch *instant* must use getOrgDateOnly instead, so the
 * bucket matches the tenant's local day rather than the server's UTC day.
 */
const getTodayDateOnly = (date = new Date()) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const timezoneCache = new Map();

/** Resolves (and briefly caches) a tenant's IANA timezone. */
const getOrgTimezone = async (organizationId) => {
  if (timezoneCache.has(organizationId)) return timezoneCache.get(organizationId);

  let timezone = DEFAULT_TIMEZONE;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    timezone = org?.timezone || DEFAULT_TIMEZONE;
  } catch {
    // Column may not exist yet on an un-migrated database — fall back to UTC.
    timezone = DEFAULT_TIMEZONE;
  }

  timezoneCache.set(organizationId, timezone);
  setTimeout(() => timezoneCache.delete(organizationId), 5 * 60 * 1000).unref?.();
  return timezone;
};

/** The attendance date bucket for an instant, in the tenant's local calendar. */
const getOrgDateOnly = async (organizationId, date = new Date()) => {
  const timezone = await getOrgTimezone(organizationId);
  return getLocalDateOnly(date, timezone);
};

/**
 * Finds the attendance record an in-progress action (break, checkout) belongs to.
 *
 * Normally that is today's row, but on an overnight shift the open punch sits on
 * the previous calendar day, so a 02:00 break would otherwise find nothing.
 */
const findOpenAttendance = async (employeeId, organizationId, at = new Date(), include = {}) => {
  const timezone = await getOrgTimezone(organizationId);
  const today = getLocalDateOnly(at, timezone);

  const todayRecord = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
    include,
  });

  if (todayRecord?.checkIn) return todayRecord;

  const carriedOver = await prisma.attendance.findFirst({
    where: {
      employeeId,
      organizationId,
      checkIn: { not: null },
      checkOut: null,
      date: { lt: today, gte: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000) },
    },
    include: { ...include, shift: true },
    orderBy: { date: "desc" },
  });

  if (carriedOver && isOvernightShift(carriedOver.shift)) {
    const elapsedHours = (at.getTime() - new Date(carriedOver.checkIn).getTime()) / 3_600_000;
    if (elapsedHours > 0 && elapsedHours <= 20) return carriedOver;
  }

  return todayRecord;
};

/**
 * Fetches org attendance policy, falling back to safe defaults if none configured.
 */
const { policySelect } = require("../utils/prismaSelects");

const getPolicy = async (organizationId) => {
  const policy = await prisma.attendancePolicy.findUnique({
    where: { organizationId },
    select: policySelect,
  });
  return {
    workingDaysPerMonth: policy?.workingDaysPerMonth ?? 26,
    halfDayThresholdMinutes: policy?.halfDayThresholdMinutes ?? 240,
    maxLatesBeforeDeduction: policy?.maxLatesBeforeDeduction ?? 3,
    lateDeductionPercent: policy ? Number(policy.lateDeductionPercent) : 0.25,
    allowWfh: policy?.allowWfh ?? true,
    requireOtApproval: policy?.requireOtApproval ?? false,
    // Matches the schema default: geofence is enforced unless an admin relaxes it.
    geofenceStrict: policy?.geofenceStrict ?? true,
    requireTrustedDevice: policy?.requireTrustedDevice ?? false,
  };
};

const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"];

/**
 * Finds the employee a request acts on.
 *
 * An explicit employeeId is only honoured for privileged roles. Previously any
 * authenticated user could pass a colleague's id and punch in as them, because
 * the lookup only checked that the employee was in the same organization.
 */
const resolveEmployee = async (userId, employeeId, organizationId, actorRole = null) => {
  const canActForOthers = actorRole === null || ADMIN_ROLES.includes(actorRole);

  let employee;
  if (employeeId && canActForOthers) {
    employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { branch: true, shift: true, user: true },
    });
  } else if (userId) {
    employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
      include: { branch: true, shift: true, user: true },
    });

    // An employee who supplied someone else's id gets a clear refusal rather
    // than silently acting on their own record.
    if (employee && employeeId && employeeId !== employee.id && !canActForOthers) {
      const error = new Error("You are not allowed to record attendance for another employee");
      error.statusCode = 403;
      throw error;
    }
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
  const dateOnly = await getOrgDateOnly(organizationId, date);

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
const isWorkingDay = (shift, date, timezone = DEFAULT_TIMEZONE) => {
  if (!shift?.workingDays) return true; // No shift = assume always working
  const schemaDay = getLocalDayOfWeek(date, timezone);
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
const assertTrustedDevice = async (employee, organizationId, policy, deviceId) => {
  if (!policy?.requireTrustedDevice) return;
  if (!deviceId) {
    const error = new Error("This organization requires a trusted device. Register this phone first.");
    error.statusCode = 403;
    throw error;
  }
  const device = await prisma.employeeDevice.findFirst({
    where: { employeeId: employee.id, organizationId, deviceId: String(deviceId), isTrusted: true },
  });
  if (!device) {
    const error = new Error("This device is not trusted. Ask an admin to approve it.");
    error.statusCode = 403;
    throw error;
  }
  await prisma.employeeDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
};

const checkIn = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp, workMode = "OFFICE", note, actorRole = null, deviceId = null }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId, actorRole);
  const checkInTime = timestamp ? new Date(timestamp) : new Date();
  const timezone = await getOrgTimezone(organizationId);
  const today = getLocalDateOnly(checkInTime, timezone);
  const policy = await getPolicy(organizationId);
  if (workMode === "WORK_FROM_HOME" && !policy.allowWfh) {
    const error = new Error("Work From Home check-in is not enabled for this organization.");
    error.statusCode = 403;
    throw error;
  }
  await assertTrustedDevice(employee, organizationId, policy, deviceId);

  // ── Week-Off / Holiday / Leave Detection ──────────────────────────────────
  const shift = await resolveShift(employee, organizationId, checkInTime);
  const isOffDay = shift ? !isWorkingDay(shift, checkInTime, timezone) : false;

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

  if (matchedBranch?.latitude && matchedBranch?.longitude) {
    try {
      geofenceResult = verifyGeofence(
        { latitude, longitude },
        { latitude: matchedBranch.latitude, longitude: matchedBranch.longitude, radiusMeters: matchedBranch.radiusMeters }
      );
      if (geofenceResult.bypassed) {
        isBypassed = true;
        bypassReason = "NO_BRANCH_GPS";
      }
    } catch (err) {
      geofenceResult = { isInside: false, distanceMeters: null, allowedRadiusMeters: matchedBranch.radiusMeters || 200, error: err.message };
    }
  }

  // Multi-branch roaming fallback
  const allBranches = await prisma.branch.findMany({ where: { organizationId } });
  const branchesWithCoords = allBranches.filter((b) => b.latitude && b.longitude);

  if (!geofenceResult || (!geofenceResult.isInside && !geofenceResult.bypassed)) {
    for (const b of branchesWithCoords) {
      try {
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
      } catch {
        // try next branch
      }
    }
  }

  // If neither the employee branch nor any organization branch has GPS coordinates configured:
  if (!matchedBranch?.latitude && branchesWithCoords.length === 0) {
    isBypassed = true;
    bypassReason = "NO_BRANCH_GPS_CONFIGURED";
    geofenceResult = {
      isInside: true,
      distanceMeters: 0,
      allowedRadiusMeters: 200,
      bypassed: true,
    };
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

const wfhCheckIn = async ({ userId, employeeId, organizationId, timestamp, wfhNote, actorRole = null, deviceId = null }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId, actorRole);
  const checkInTime = timestamp ? new Date(timestamp) : new Date();
  const timezone = await getOrgTimezone(organizationId);
  const today = getLocalDateOnly(checkInTime, timezone);
  const policy = await getPolicy(organizationId);
  await assertTrustedDevice(employee, organizationId, policy, deviceId);

  if (!policy.allowWfh) {
    const error = new Error("Work From Home check-in is not enabled for this organization.");
    error.statusCode = 403;
    throw error;
  }

  const shift = await resolveShift(employee, organizationId, checkInTime);
  const isOffDay = shift ? !isWorkingDay(shift, checkInTime, timezone) : false;

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

const checkOut = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp, workMode, note, actorRole = null, deviceId = null }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId, actorRole);
  const policy = await getPolicy(organizationId);
  await assertTrustedDevice(employee, organizationId, policy, deviceId);
  const checkOutTime = timestamp ? new Date(timestamp) : new Date();
  const timezone = await getOrgTimezone(organizationId);
  const today = getLocalDateOnly(checkOutTime, timezone);

  let attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: {
      shift: true,
      events: { orderBy: { timestamp: "desc" } },
    },
  });

  // A night shift that starts before midnight belongs to the previous calendar
  // day. Without this, the 06:00 checkout of a 22:00 shift looks for today's
  // record, finds nothing, and the employee can never clock out.
  if (!attendance || !attendance.checkIn) {
    const openShift = await prisma.attendance.findFirst({
      where: {
        employeeId: employee.id,
        organizationId,
        checkIn: { not: null },
        checkOut: null,
        date: { lt: today, gte: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000) },
      },
      include: {
        shift: true,
        events: { orderBy: { timestamp: "desc" } },
      },
      orderBy: { date: "desc" },
    });

    // Only adopt it when the open punch genuinely belongs to an overnight shift
    // and is still within a plausible window, so a forgotten checkout from days
    // ago is not silently closed against today's punch.
    if (openShift) {
      const elapsedHours =
        (checkOutTime.getTime() - new Date(openShift.checkIn).getTime()) / 3_600_000;
      if (isOvernightShift(openShift.shift) && elapsedHours > 0 && elapsedHours <= 20) {
        attendance = openShift;
      }
    }
  }

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

  // Metrics are evaluated against the shift's own day, not the checkout instant,
  // which for an overnight shift is already the following calendar date.
  const attendanceDate = attendance.date;

  // Resolve shift with override support
  let shift = attendance.shift || (await resolveShift(employee, organizationId, attendanceDate));
  const isOffDay = shift ? !isWorkingDay(shift, attendanceDate, timezone) : false;

  const [holiday, approvedLeave] = await Promise.all([
    prisma.holiday.findFirst({
      where: {
        organizationId,
        date: attendanceDate,
        isOptional: false,
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
    }),
    prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: "APPROVED",
        startDate: { lte: attendanceDate },
        endDate: { gte: attendanceDate },
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
    const policy = await getPolicy(organizationId);
    metrics = evaluateAttendanceAgainstShift(shift, attendance.checkIn, checkOutTime, totalBreakMinutes, {
      timeZone: timezone,
      halfDayThresholdMinutes: policy.halfDayThresholdMinutes,
    });

    // When the org requires OT sign-off, minutes are parked on a request rather
    // than credited straight to the payslip.
    if (policy.requireOtApproval && metrics.overtimeMinutes > 0) {
      metrics.pendingOvertimeMinutes = metrics.overtimeMinutes;
      metrics.overtimeMinutes = 0;
      metrics.overtimeHours = "0.0";
      metrics.overtimeFormatted = formatMinutes(0);
      metrics.overtimeRequiresApproval = true;
    }
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

    // Working a rest day, holiday or approved-leave day earns comp-off. This was
    // advertised by the product but never actually credited.
    if (isNonWorkingDay && calculatedWorkingMinutes >= 240) {
      const earnedDays = calculatedWorkingMinutes >= 480 ? 1 : 0.5;
      const balance = await tx.compOffBalance.upsert({
        where: { employeeId: employee.id },
        update: { creditedDays: { increment: earnedDays } },
        create: {
          organizationId,
          employeeId: employee.id,
          creditedDays: earnedDays,
          usedDays: 0,
        },
      });

      const alreadyCredited = await tx.compOffTransaction.findFirst({
        where: {
          compOffBalanceId: balance.id,
          type: "CREDIT",
          referenceDate: attendanceDate,
        },
      });

      if (!alreadyCredited) {
        // Credits lapse after 90 days unless used.
        const expiresAt = new Date(attendanceDate);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);

        await tx.compOffTransaction.create({
          data: {
            compOffBalanceId: balance.id,
            type: "CREDIT",
            days: earnedDays,
            reason: "Worked on a rest day / holiday",
            referenceDate: attendanceDate,
            expiresAt,
          },
        });
      } else {
        // Undo the increment above; this day was already credited.
        await tx.compOffBalance.update({
          where: { employeeId: employee.id },
          data: { creditedDays: { decrement: earnedDays } },
        });
      }
    }

    // Overtime that needs sign-off is raised as a request so a reviewer can act
    // on it, instead of being silently discarded.
    if (metrics.pendingOvertimeMinutes > 0) {
      const existingRequest = await tx.overtimeRequest.findFirst({
        where: { attendanceId: attendance.id, status: "PENDING" },
      });
      if (!existingRequest) {
        await tx.overtimeRequest.create({
          data: {
            organizationId,
            employeeId: employee.id,
            attendanceId: attendance.id,
            requestedMinutes: metrics.pendingOvertimeMinutes,
            reason: "Auto-raised from checkout — organization requires overtime approval",
            status: "PENDING",
          },
        });
      }
    }

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

const startBreak = async ({ userId, employeeId, organizationId, latitude, longitude, timestamp, actorRole = null }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId, actorRole);
  const eventTime = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(eventTime.getTime())) {
    const error = new Error("Invalid break timestamp");
    error.statusCode = 400;
    throw error;
  }

  const attendance = await findOpenAttendance(employee.id, organizationId, eventTime, {
    events: { orderBy: { timestamp: "desc" } },
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

  const breakStartTime = eventTime;
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

const endBreak = async ({ userId, employeeId, organizationId, latitude, longitude, timestamp, actorRole = null }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId, actorRole);
  const eventTime = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(eventTime.getTime())) {
    const error = new Error("Invalid break timestamp");
    error.statusCode = 400;
    throw error;
  }

  const attendance = await findOpenAttendance(employee.id, organizationId, eventTime, {
    events: { orderBy: { timestamp: "desc" } },
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

  const breakEndTime = eventTime;
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
    attendance = await findOpenAttendance(employee.id, organizationId, new Date(), {
      events: { orderBy: { timestamp: "asc" } },
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

  const targetDate = await getOrgDateOnly(organizationId, new Date(date));
  const shift = await resolveShift(employee, organizationId, new Date(date));
  const timezone = await getOrgTimezone(organizationId);
  const policy = await getPolicy(organizationId);

  let workingMinutes = 0;
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let overtimeMinutes = 0;

  if (checkIn && checkOut && shift) {
    const metrics = evaluateAttendanceAgainstShift(
      shift,
      new Date(checkIn),
      new Date(checkOut),
      0,
      { timeZone: timezone, halfDayThresholdMinutes: policy.halfDayThresholdMinutes }
    );
    workingMinutes = metrics.workingMinutes;
    lateMinutes = metrics.lateMinutes;
    earlyMinutes = metrics.earlyMinutes;
    overtimeMinutes = metrics.overtimeMinutes;
  }

  // The attendance row and its audit trail must land together, otherwise a
  // manual override can be applied with no record of who made it.
  const attendance = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.upsert({
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

    await tx.auditLog.create({
      data: {
        organizationId,
        userId: adminUserId,
        action: "UPDATE",
        entity: "ATTENDANCE",
        entityId: record.id,
        details: `Admin manually marked attendance as ${status} for employee ${employeeId} on ${date}. Reason: ${reason || "N/A"}`,
      },
    });

    return record;
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

  const attendance = await findOpenAttendance(employee.id, organizationId, new Date(), {
    shift: true,
    branch: true,
    events: { orderBy: { timestamp: "desc" } },
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
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            designation: true,
            department: { select: { id: true, name: true } },
            user: { select: { email: true, role: true } },
          },
        },
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
    const { id: localId, type, timestamp, latitude, longitude, accuracy, wfhNote, workMode, note, deviceId } = punch;

    try {
      let result;

      switch (type) {
        case "CHECK_IN":
          result = await checkIn({ userId, organizationId, latitude, longitude, accuracy, timestamp, workMode, note, deviceId });
          break;

        case "WFH_CHECK_IN":
          result = await wfhCheckIn({ userId, organizationId, timestamp, wfhNote, deviceId });
          break;

        case "CHECK_OUT":
          result = await checkOut({ userId, organizationId, latitude, longitude, accuracy, timestamp, workMode, note, deviceId });
          break;

        case "BREAK_START":
          result = await startBreak({ userId, organizationId, latitude, longitude, timestamp });
          break;

        case "BREAK_END":
          result = await endBreak({ userId, organizationId, latitude, longitude, timestamp });
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
  getOrgTimezone,
  getOrgDateOnly,
  resolveShift,
  findOpenAttendance,
  getPolicy,
  syncOfflinePunches,
};
