const prisma = require("../config/database");
const { getScheduledDurationMinutes } = require("../utils/shiftCalculator");

const createShift = async (organizationId, data) => {
  const { name, startTime, endTime, graceMinutes, workingDays = "1,2,3,4,5,6" } = data;

  if (!name || !name.trim()) {
    throw new Error("Shift name is required");
  }

  if (!startTime || !endTime) {
    throw new Error("Shift start time and end time are required (e.g. 09:00, 18:00)");
  }

  const shift = await prisma.shift.create({
    data: {
      organizationId,
      name: name.trim(),
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      graceMinutes: graceMinutes ? parseInt(graceMinutes, 10) : 10,
      workingDays: workingDays ? workingDays.trim() : "1,2,3,4,5,6",
    },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });

  const durationMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);

  return {
    ...shift,
    durationMinutes,
    durationHours: (durationMinutes / 60).toFixed(1),
  };
};

const getShifts = async (organizationId) => {
  const shifts = await prisma.shift.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { employees: true, attendances: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return shifts.map((shift) => {
    const durationMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);
    return {
      ...shift,
      durationMinutes,
      durationHours: (durationMinutes / 60).toFixed(1),
    };
  });
};

const getShiftById = async (organizationId, shiftId) => {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, organizationId },
    include: {
      employees: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
          status: true,
          department: { select: { name: true } },
          branch: { select: { name: true } },
        },
      },
      _count: {
        select: { employees: true, attendances: true },
      },
    },
  });

  if (!shift) {
    throw new Error("Shift not found in this organization");
  }

  const durationMinutes = getScheduledDurationMinutes(shift.startTime, shift.endTime);

  return {
    ...shift,
    durationMinutes,
    durationHours: (durationMinutes / 60).toFixed(1),
  };
};

const updateShift = async (organizationId, shiftId, data) => {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, organizationId },
  });

  if (!shift) {
    throw new Error("Shift not found in this organization");
  }

  const { name, startTime, endTime, graceMinutes, workingDays } = data;

  const updated = await prisma.shift.update({
    where: { id: shiftId },
    data: {
      ...(name ? { name: name.trim() } : {}),
      ...(startTime ? { startTime: startTime.trim() } : {}),
      ...(endTime ? { endTime: endTime.trim() } : {}),
      ...(graceMinutes !== undefined ? { graceMinutes: parseInt(graceMinutes, 10) } : {}),
      ...(workingDays ? { workingDays: workingDays.trim() } : {}),
    },
    include: {
      _count: {
        select: { employees: true },
      },
    },
  });

  const durationMinutes = getScheduledDurationMinutes(updated.startTime, updated.endTime);

  return {
    ...updated,
    durationMinutes,
    durationHours: (durationMinutes / 60).toFixed(1),
  };
};

const deleteShift = async (organizationId, shiftId) => {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, organizationId },
  });

  if (!shift) {
    throw new Error("Shift not found in this organization");
  }

  return await prisma.$transaction(async (tx) => {
    // Unassign shift from employees
    await tx.employee.updateMany({
      where: { shiftId },
      data: { shiftId: null },
    });

    // Unassign shift from attendance records if needed
    await tx.attendance.updateMany({
      where: { shiftId },
      data: { shiftId: null },
    });

    await tx.shift.delete({
      where: { id: shiftId },
    });

    return { success: true };
  });
};

const assignEmployeesToShift = async (organizationId, shiftId, employeeIds) => {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, organizationId },
  });

  if (!shift) {
    throw new Error("Shift not found in this organization");
  }

  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    throw new Error("employeeIds must be a non-empty array of employee IDs");
  }

  const result = await prisma.employee.updateMany({
    where: {
      id: { in: employeeIds },
      organizationId,
    },
    data: {
      shiftId,
    },
  });

  return {
    success: true,
    message: `Assigned ${result.count} employees to ${shift.name}`,
    shift,
    count: result.count,
  };
};

module.exports = {
  createShift,
  getShifts,
  getShiftById,
  updateShift,
  deleteShift,
  assignEmployeesToShift,
};
