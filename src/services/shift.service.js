const prisma = require("../config/database");
const { getScheduledDurationMinutes } = require("../utils/shiftCalculator");
const { assertTime, normalizeWorkingDays } = require("../utils/shiftValidation");
const { workingDaysFromWeeklyOff } = require("../utils/policyValidation");

// A shift card represents the current workforce, not historical/deleted staff.
// Keep this identical to the employee list's WORKING filter.
const WORKING_EMPLOYEE_STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD"];
const currentEmployeeWhere = {
  deletedAt: null,
  status: { in: WORKING_EMPLOYEE_STATUSES },
};

/** Working days for a new shift: the company's weekly off decides, Sunday off unless the policy says otherwise. */
const companyWorkingDays = async (organizationId) => {
  const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId }, select: { weeklyOffDays: true } });
  return workingDaysFromWeeklyOff(policy?.weeklyOffDays ?? "0") || "1,2,3,4,5,6";
};

const normalizeMinutes = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const buildShiftMetrics = (shift) => {
  const durationMinutes = Number.isFinite(Number(shift.totalWorkingMinutes)) && Number(shift.totalWorkingMinutes) > 0
    ? Number(shift.totalWorkingMinutes)
    : getScheduledDurationMinutes(shift.startTime, shift.endTime);
  const configuredBreakMinutes = shift.breakIncluded ? normalizeMinutes(shift.breakMinutes) : 0;
  const configuredLunchMinutes = shift.lunchIncluded ? normalizeMinutes(shift.lunchMinutes) : 0;
  const scheduledWorkMinutes = Math.max(0, durationMinutes - configuredBreakMinutes - configuredLunchMinutes);
  return {
    durationMinutes,
    durationHours: (durationMinutes / 60).toFixed(1),
    configuredBreakMinutes,
    configuredLunchMinutes,
    scheduledWorkMinutes,
    scheduledWorkHours: (scheduledWorkMinutes / 60).toFixed(1),
  };
};

const validateShiftPauseConfig = (startTime, endTime, breakMinutes, lunchMinutes) => {
  const durationMinutes = getScheduledDurationMinutes(startTime, endTime);
  if (breakMinutes + lunchMinutes > durationMinutes) {
    const error = new Error("Break and lunch time cannot exceed the shift duration");
    error.statusCode = 400;
    throw error;
  }
};

const createShift = async (organizationId, data) => {
  const { name, startTime, endTime, graceMinutes, breakMinutes = 0, lunchMinutes = 0, breakIncluded = true, lunchIncluded = true, workingDays, flexiblePunching = false, totalWorkingMinutes } = data;
  if (!name || !name.trim()) throw new Error("Shift name is required");
  if (!startTime || !endTime) throw new Error("Shift start time and end time are required (e.g. 09:00, 18:00)");
  const cleanStart = assertTime("Start time", startTime);
  const cleanEnd = assertTime("End time", endTime);
  const cleanWorkingDays = normalizeWorkingDays(workingDays || (await companyWorkingDays(organizationId)));

  const normalizedBreakMinutes = normalizeMinutes(breakMinutes);
  const normalizedLunchMinutes = normalizeMinutes(lunchMinutes);
  const effectiveBreakMinutes = breakIncluded !== false ? normalizedBreakMinutes : 0;
  const effectiveLunchMinutes = lunchIncluded !== false ? normalizedLunchMinutes : 0;
  validateShiftPauseConfig(cleanStart, cleanEnd, effectiveBreakMinutes, effectiveLunchMinutes);

  const shift = await prisma.shift.create({
    data: {
      organizationId,
      name: name.trim(),
      startTime: cleanStart,
      endTime: cleanEnd,
      graceMinutes: graceMinutes !== undefined ? normalizeMinutes(graceMinutes, 10) : 10,
      breakMinutes: normalizedBreakMinutes,
      lunchMinutes: normalizedLunchMinutes,
      breakIncluded: breakIncluded !== false,
      lunchIncluded: lunchIncluded !== false,
      workingDays: cleanWorkingDays,
      flexiblePunching: flexiblePunching === true,
      totalWorkingMinutes: totalWorkingMinutes !== undefined ? normalizeMinutes(totalWorkingMinutes) || null : null,
    },
    include: { _count: { select: { employees: true } } },
  });

  return { ...shift, ...buildShiftMetrics(shift) };
};

const getShifts = async (organizationId) => {
  const shifts = await prisma.shift.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: {
          employees: { where: currentEmployeeWhere },
          attendances: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return shifts.map((shift) => ({ ...shift, ...buildShiftMetrics(shift) }));
};

const getShiftById = async (organizationId, shiftId) => {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, organizationId },
    include: {
      employees: {
        where: currentEmployeeWhere,
        select: {
          id: true, firstName: true, lastName: true, employeeCode: true, status: true,
          department: { select: { name: true } }, branch: { select: { name: true } },
        },
      },
      _count: {
        select: {
          employees: { where: currentEmployeeWhere },
          attendances: true,
        },
      },
    },
  });
  if (!shift) throw new Error("Shift not found in this organization");
  return { ...shift, ...buildShiftMetrics(shift) };
};

const updateShift = async (organizationId, shiftId, data) => {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
  if (!shift) throw new Error("Shift not found in this organization");

  const { name, startTime, endTime, graceMinutes, breakMinutes, lunchMinutes, breakIncluded, lunchIncluded, workingDays, flexiblePunching, totalWorkingMinutes } = data;
  const nextStartTime = startTime ? assertTime("Start time", startTime) : shift.startTime;
  const nextEndTime = endTime ? assertTime("End time", endTime) : shift.endTime;
  const nextWorkingDays = workingDays ? normalizeWorkingDays(workingDays) : undefined;
  const nextBreakIncluded = breakIncluded !== undefined ? breakIncluded !== false : shift.breakIncluded;
  const nextLunchIncluded = lunchIncluded !== undefined ? lunchIncluded !== false : shift.lunchIncluded;
  const nextBreakMinutes = breakMinutes !== undefined ? normalizeMinutes(breakMinutes) : shift.breakMinutes;
  const nextLunchMinutes = lunchMinutes !== undefined ? normalizeMinutes(lunchMinutes) : shift.lunchMinutes;
  validateShiftPauseConfig(nextStartTime, nextEndTime, nextBreakIncluded ? nextBreakMinutes : 0, nextLunchIncluded ? nextLunchMinutes : 0);

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(startTime ? { startTime: nextStartTime } : {}),
      ...(endTime ? { endTime: nextEndTime } : {}),
      ...(graceMinutes !== undefined ? { graceMinutes: normalizeMinutes(graceMinutes) } : {}),
      ...(breakMinutes !== undefined ? { breakMinutes: nextBreakMinutes } : {}),
      ...(lunchMinutes !== undefined ? { lunchMinutes: nextLunchMinutes } : {}),
      ...(breakIncluded !== undefined ? { breakIncluded: nextBreakIncluded } : {}),
      ...(lunchIncluded !== undefined ? { lunchIncluded: nextLunchIncluded } : {}),
      ...(nextWorkingDays ? { workingDays: nextWorkingDays } : {}),
      ...(flexiblePunching !== undefined ? { flexiblePunching: flexiblePunching === true } : {}),
      ...(totalWorkingMinutes !== undefined ? { totalWorkingMinutes: normalizeMinutes(totalWorkingMinutes) || null } : {}),
    },
    include: { _count: { select: { employees: true } } },
  });
  return { ...updated, ...buildShiftMetrics(updated) };
};

const deleteShift = async (organizationId, shiftId) => {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
  if (!shift) throw new Error("Shift not found in this organization");
  // Deleting under people would silently drop them onto the default schedule, changing how their
  // lateness and payroll days are classified. Make that an explicit reassignment instead.
  const assigned = await prisma.employee.count({ where: { shiftId, organizationId } });
  if (assigned > 0) {
    const error = new Error(`${assigned} employee${assigned === 1 ? "" : "s"} still use this shift. Assign them to another shift before deleting it.`);
    error.statusCode = 409;
    throw error;
  }
  return prisma.$transaction(async (tx) => {
    await tx.employee.updateMany({ where: { shiftId }, data: { shiftId: null } });
    await tx.attendance.updateMany({ where: { shiftId }, data: { shiftId: null } });
    await tx.shift.delete({ where: { id: shiftId } });
    return { success: true };
  });
};

const assignEmployeesToShift = async (organizationId, shiftId, employeeIds, flexibleEmployeeIds = []) => {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
  if (!shift) throw new Error("Shift not found in this organization");
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) throw new Error("employeeIds must be a non-empty array of employee IDs");
  const flexibleIds = new Set(Array.isArray(flexibleEmployeeIds) ? flexibleEmployeeIds : []);
  const result = await prisma.$transaction(
    employeeIds.map((employeeId) => prisma.employee.updateMany({
      where: { id: employeeId, organizationId },
      data: { shiftId, flexiblePunching: flexibleIds.has(employeeId) },
    }))
  );
  return { success: true, message: `Assigned ${employeeIds.length} employees to ${shift.name}`, shift, count: employeeIds.length };
};

const removeEmployeeFromShift = async (organizationId, shiftId, employeeId) => {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId }, select: { id: true, name: true } });
  if (!shift) throw new Error("Shift not found in this organization");
  const result = await prisma.employee.updateMany({
    where: { id: employeeId, organizationId, shiftId },
    data: { shiftId: null, flexiblePunching: false },
  });
  if (!result.count) {
    const error = new Error("This employee is not assigned to the selected shift");
    error.statusCode = 404;
    throw error;
  }
  return { success: true, message: `Employee removed from ${shift.name}`, count: result.count };
};

module.exports = { createShift, getShifts, getShiftById, updateShift, deleteShift, assignEmployeesToShift, removeEmployeeFromShift };
