const prisma = require("../config/database");
const { verifyGeofence } = require("../utils/geofence");
const {
  calculateLateMinutes,
  evaluateAttendanceAgainstShift,
  formatMinutes,
} = require("../utils/shiftCalculator");

/**
 * Normalizes a date to UTC midnight for unique daily attendance indexing.
 */
const getTodayDateOnly = (date = new Date()) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
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
 * Step 6: Clock-In Flow
 * Mobile / Web -> JWT -> Employee -> Branch -> GPS -> Haversine Geofence -> Shift -> Late Calc -> Attendance + Event
 */
const checkIn = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp }) => {
  // 1. Resolve Employee
  const employee = await resolveEmployee(userId, employeeId, organizationId);

  // 2. Resolve Branch & Check Multi-Branch Roaming Geofence
  let matchedBranch = employee.branch;
  let geofenceResult = null;

  if (matchedBranch) {
    geofenceResult = verifyGeofence(
      { latitude, longitude },
      { latitude: matchedBranch.latitude, longitude: matchedBranch.longitude, radiusMeters: matchedBranch.radiusMeters }
    );
  }

  // If outside assigned branch or employee has no assigned branch, check other organization branches
  if (!geofenceResult || !geofenceResult.isInside) {
    const allBranches = await prisma.branch.findMany({
      where: { organizationId },
    });

    for (const b of allBranches) {
      const check = verifyGeofence(
        { latitude, longitude },
        { latitude: b.latitude, longitude: b.longitude, radiusMeters: b.radiusMeters }
      );
      if (check.isInside) {
        matchedBranch = b;
        geofenceResult = check;
        break;
      }
    }
  }

  if (!geofenceResult || !geofenceResult.isInside) {
    const error = new Error(
      `Outside allowed branch boundary. Distance: ${geofenceResult?.distanceMeters || "N/A"}m, Max allowed: ${geofenceResult?.allowedRadiusMeters || 200}m`
    );
    error.statusCode = 400;
    error.details = geofenceResult;
    throw error;
  }

  // 3. Resolve Shift & Calculate Late Minutes
  const checkInTime = timestamp ? new Date(timestamp) : new Date();
  let shift = employee.shift;
  if (!shift) {
    shift = await prisma.shift.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  let lateMinutes = 0;
  let status = "PRESENT";

  if (shift) {
    lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkInTime);
    if (lateMinutes > 0) {
      status = "LATE";
    }
  }

  const today = getTodayDateOnly(checkInTime);

  // 4. Check if already checked in today
  const existingAttendance = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: today,
      },
    },
    include: { events: true },
  });

  if (existingAttendance && existingAttendance.checkIn) {
    const timeStr = new Date(existingAttendance.checkIn).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const error = new Error(`Already checked in for today at ${timeStr}`);
    error.statusCode = 400;
    error.attendance = existingAttendance;
    throw error;
  }

  // 5. Create or Update Attendance Record & Create CHECK_IN Event
  const attendance = await prisma.$transaction(async (tx) => {
    const record = await tx.attendance.upsert({
      where: {
        employeeId_date: {
          employeeId: employee.id,
          date: today,
        },
      },
      update: {
        checkIn: checkInTime,
        checkInLatitude: latitude ? String(latitude) : null,
        checkInLongitude: longitude ? String(longitude) : null,
        branchId: matchedBranch?.id || null,
        shiftId: shift?.id || null,
        status,
        lateMinutes,
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
      },
    });

    return { ...record, event };
  });

  return {
    success: true,
    message: status === "LATE" ? `Checked in late by ${lateMinutes} minutes` : "Checked in successfully on time",
    attendance,
    geofence: geofenceResult,
    branch: matchedBranch ? { id: matchedBranch.id, name: matchedBranch.name, radiusMeters: matchedBranch.radiusMeters } : null,
    shift: shift ? { id: shift.id, name: shift.name, startTime: shift.startTime, graceMinutes: shift.graceMinutes } : null,
  };
};

/**
 * Step 6: Clock-Out Flow
 * Computes workingMinutes, earlyMinutes, overtimeMinutes, and updates status
 */
const checkOut = async ({ userId, employeeId, organizationId, latitude, longitude, accuracy, timestamp }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const checkOutTime = timestamp ? new Date(timestamp) : new Date();
  const today = getTodayDateOnly(checkOutTime);

  const attendance = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: today,
      },
    },
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
    const timeStr = new Date(attendance.checkOut).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const error = new Error(`Already checked out for today at ${timeStr}`);
    error.statusCode = 400;
    error.attendance = attendance;
    throw error;
  }

  // Resolve shift: attendance.shift || employee.shift || default org shift
  let shift = attendance.shift || employee.shift;
  if (!shift) {
    shift = await prisma.shift.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  // Check if employee is currently on an unclosed break
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

  let metrics = {
    scheduledMinutes: 480,
    workingMinutes: Math.max(0, elapsedMinutes - totalBreakMinutes),
    workingHours: (Math.max(0, elapsedMinutes - totalBreakMinutes) / 60).toFixed(1),
    workingFormatted: formatMinutes(Math.max(0, elapsedMinutes - totalBreakMinutes)),
    breakMinutes: totalBreakMinutes,
    breakFormatted: formatMinutes(totalBreakMinutes),
    earlyMinutes: 0,
    earlyFormatted: "0m",
    overtimeMinutes: Math.max(0, elapsedMinutes - totalBreakMinutes - 480),
    overtimeHours: (Math.max(0, elapsedMinutes - totalBreakMinutes - 480) / 60).toFixed(1),
    overtimeFormatted: formatMinutes(Math.max(0, elapsedMinutes - totalBreakMinutes - 480)),
    status: attendance.status,
  };

  if (shift) {
    metrics = evaluateAttendanceAgainstShift(shift, attendance.checkIn, checkOutTime, totalBreakMinutes);
  }

  // Update attendance, auto-close break event if active, and create CHECK_OUT event in transaction
  const updatedAttendance = await prisma.$transaction(async (tx) => {
    if (isOnActiveBreak) {
      await tx.attendanceEvent.create({
        data: {
          attendanceId: attendance.id,
          type: "BREAK_END",
          timestamp: checkOutTime,
          latitude: latitude ? String(latitude) : null,
          longitude: longitude ? String(longitude) : null,
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
        lateMinutes: metrics.lateMinutes,
        earlyMinutes: metrics.earlyMinutes || 0,
        overtimeMinutes: metrics.overtimeMinutes || 0,
        status: metrics.status || attendance.status,
      },
    });

    const event = await tx.attendanceEvent.create({
      data: {
        attendanceId: attendance.id,
        type: "CHECK_OUT",
        timestamp: checkOutTime,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
        accuracy: accuracy ? String(accuracy) : null,
      },
    });

    return { ...updated, event };
  });

  return {
    success: true,
    message: metrics.lateArrivalWaived
      ? `Checked out successfully. Logged ${metrics.workingFormatted} (Full 8h completed — Late arrival waived)!`
      : `Checked out successfully. Working: ${metrics.workingFormatted}, Breaks: ${metrics.breakFormatted || '0m'}`,
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

/**
 * Step 6.6: Start Break
 */
const startBreak = async ({ userId, employeeId, organizationId, latitude, longitude }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const today = getTodayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { events: { orderBy: { timestamp: "desc" } } },
  });

  if (!attendance || !attendance.checkIn) {
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
  if (lastEvent && lastEvent.type === "BREAK_START") {
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
    },
  });

  return {
    success: true,
    message: `Break started at ${breakStartTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    event,
    attendance,
  };
};

/**
 * Step 6.6: End Break
 */
const endBreak = async ({ userId, employeeId, organizationId, latitude, longitude }) => {
  const employee = await resolveEmployee(userId, employeeId, organizationId);
  const today = getTodayDateOnly();

  const attendance = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
    include: { events: { orderBy: { timestamp: "desc" } } },
  });

  if (!attendance || !attendance.checkIn) {
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
      data: {
        breakMinutes: (attendance.breakMinutes || 0) + durationMinutes,
      },
    });

    const event = await tx.attendanceEvent.create({
      data: {
        attendanceId: attendance.id,
        type: "BREAK_END",
        timestamp: breakEndTime,
        latitude: latitude ? String(latitude) : null,
        longitude: longitude ? String(longitude) : null,
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

/**
 * Returns today's active attendance status for the current user
 */
const getTodayStatus = async (userId, organizationId) => {
  const employee = await prisma.employee.findFirst({
    where: { userId, organizationId },
    include: { branch: true, shift: true },
  });

  if (!employee) {
    return {
      hasEmployeeProfile: false,
      clockedIn: false,
      attendance: null,
    };
  }

  const today = getTodayDateOnly();
  const attendance = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: today,
      },
    },
    include: {
      shift: true,
      branch: true,
      events: { orderBy: { timestamp: "desc" } },
    },
  });

  const clockedIn = Boolean(attendance?.checkIn && !attendance?.checkOut);
  const isOnBreak = Boolean(clockedIn && attendance?.events?.[0]?.type === "BREAK_START");

  return {
    hasEmployeeProfile: true,
    employee: {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
      employeeCode: employee.employeeCode,
      branch: employee.branch,
      shift: employee.shift,
    },
    clockedIn,
    isOnBreak,
    attendance,
  };
};

/**
 * Returns personal attendance history for the logged-in employee
 */
const getMyAttendance = async (userId, organizationId, { limit = 30, page = 1 }) => {
  const employee = await prisma.employee.findFirst({
    where: { userId, organizationId },
  });

  if (!employee) {
    return { records: [], total: 0 };
  }

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
    prisma.attendance.count({
      where: { employeeId: employee.id, organizationId },
    }),
  ]);

  return {
    records,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / take),
  };
};

/**
 * Returns all organization attendance records for Manager / Admin
 */
const getAllAttendance = async (organizationId, query = {}) => {
  const { date, employeeId, branchId, status, page = 1, limit = 50 } = query;

  const where = { organizationId };

  if (date) {
    where.date = getTodayDateOnly(new Date(date));
  }
  if (employeeId) {
    where.employeeId = employeeId;
  }
  if (branchId) {
    where.branchId = branchId;
  }
  if (status && status !== "ALL") {
    where.status = status;
  }

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
            user: { select: { email: true } },
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

  return {
    records,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / take),
  };
};

/**
 * Returns summary KPIs for today (Total workforce, Present, Late, Absent, Clocked In)
 */
const getAttendanceSummary = async (organizationId, targetDate = new Date()) => {
  const date = getTodayDateOnly(targetDate);

  const [totalEmployees, todayAttendances, todayHoliday] = await Promise.all([
    prisma.employee.count({
      where: { organizationId, status: "ACTIVE" },
    }),
    prisma.attendance.findMany({
      where: { organizationId, date },
      select: { status: true, checkIn: true, checkOut: true },
    }),
    prisma.holiday.findFirst({
      where: { organizationId, date, isOptional: false },
    }),
  ]);

  let present = 0;
  let late = 0;
  let halfDay = 0;
  let onLeave = 0;
  let holidayCount = 0;
  let currentlyClockedIn = 0;

  todayAttendances.forEach((att) => {
    if (att.status === "PRESENT") present++;
    if (att.status === "LATE") late++;
    if (att.status === "HALF_DAY") halfDay++;
    if (att.status === "ON_LEAVE") onLeave++;
    if (att.status === "HOLIDAY") holidayCount++;
    if (att.checkIn && !att.checkOut) currentlyClockedIn++;
  });

  const isTodayHoliday = Boolean(todayHoliday);
  const totalMarked = todayAttendances.length;
  // If today is an official holiday, unmarked staff are on holiday, not absent!
  const absent = isTodayHoliday ? 0 : Math.max(0, totalEmployees - totalMarked);
  if (isTodayHoliday && holidayCount === 0) {
    holidayCount = Math.max(0, totalEmployees - (present + late + halfDay + onLeave));
  }

  return {
    date: date.toISOString().split("T")[0],
    totalEmployees,
    present,
    late,
    halfDay,
    onLeave,
    holiday: holidayCount,
    absent,
    isHoliday: isTodayHoliday,
    holidayName: todayHoliday ? todayHoliday.name : null,
    holidayType: todayHoliday ? todayHoliday.type : null,
    currentlyClockedIn,
    attendanceRate: totalEmployees > 0 ? Math.round(((present + late) / totalEmployees) * 100) : 0,
  };
};

/**
 * Step 6: Attendance History with Advanced Filtering & Pagination
 * Supports: page, limit, from, to, status, employeeId
 */
const getAttendanceHistory = async ({
  userId,
  organizationId,
  role,
  employeeId,
  from,
  to,
  status,
  page = 1,
  limit = 20,
}) => {
  const where = { organizationId };

  // Role scoping: regular employees can ONLY view their own records
  if (role === "EMPLOYEE") {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });
    if (!employee) {
      return { success: true, total: 0, page: 1, limit: parseInt(limit) || 20, totalPages: 0, records: [] };
    }
    where.employeeId = employee.id;
  } else if (employeeId) {
    // Admins and Managers can optionally filter by a specific employee
    where.employeeId = employeeId;
  }

  // Date range filtering (from & to)
  if (from || to) {
    where.date = {};
    if (from) {
      where.date.gte = getTodayDateOnly(new Date(from));
    }
    if (to) {
      where.date.lte = getTodayDateOnly(new Date(to));
    }
  }

  // Status filtering (e.g. PRESENT, LATE, HALF_DAY, ABSENT, ON_LEAVE)
  if (status && status !== "ALL") {
    where.status = status;
  }

  const take = Math.max(1, parseInt(limit) || 20);
  const curPage = Math.max(1, parseInt(page) || 1);
  const skip = (curPage - 1) * take;

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

  return {
    success: true,
    page: curPage,
    limit: take,
    total,
    totalPages: Math.ceil(total / take) || 1,
    records,
  };
};

module.exports = {
  checkIn,
  checkOut,
  startBreak,
  endBreak,
  getTodayStatus,
  getMyAttendance,
  getAllAttendance,
  getAttendanceHistory,
  getAttendanceSummary,
  getTodayDateOnly,
};
