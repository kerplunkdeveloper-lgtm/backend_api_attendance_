const prisma = require("../config/database");
const { evaluateAttendanceAgainstShift, calculateLateMinutes } = require("../utils/shiftCalculator");
const { getTodayDateOnly } = require("./attendance.service");

class CorrectionService {
  /**
   * Submit an attendance regularization/correction request
   */
  async createCorrectionRequest(userId, organizationId, data) {
    const { date, requestedCheckIn, requestedCheckOut, reason, attendanceId } = data;

    if (!date || !reason) {
      const error = new Error("Date and reason are required for attendance correction");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) {
      const error = new Error("Active employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    const targetDate = getTodayDateOnly(new Date(date));

    // Check if a pending request already exists for this date
    const existingPending = await prisma.attendanceCorrection.findFirst({
      where: {
        employeeId: employee.id,
        date: targetDate,
        status: "PENDING",
      },
    });

    if (existingPending) {
      const error = new Error("A pending correction request already exists for this date");
      error.statusCode = 400;
      throw error;
    }

    const correction = await prisma.attendanceCorrection.create({
      data: {
        organizationId,
        employeeId: employee.id,
        attendanceId: attendanceId || null,
        date: targetDate,
        requestedCheckIn: requestedCheckIn ? new Date(requestedCheckIn) : null,
        requestedCheckOut: requestedCheckOut ? new Date(requestedCheckOut) : null,
        reason,
        status: "PENDING",
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });

    return correction;
  }

  /**
   * Get correction requests for the current employee
   */
  async getMyRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    return await prisma.attendanceCorrection.findMany({
      where: { employeeId: employee.id, organizationId },
      include: {
        attendance: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get all organization correction requests (Managers & Admins)
   */
  async getAllRequests(organizationId, query = {}) {
    const { status, employeeId, page = 1, limit = 50 } = query;
    const where = { organizationId };

    if (status && status !== "ALL") {
      where.status = status;
    }
    if (employeeId) {
      where.employeeId = employeeId;
    }

    const take = parseInt(limit) || 50;
    const skip = ((parseInt(page) || 1) - 1) * take;

    const [records, total] = await Promise.all([
      prisma.attendanceCorrection.findMany({
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
          attendance: true,
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.attendanceCorrection.count({ where }),
    ]);

    return { records, total, page: parseInt(page), totalPages: Math.ceil(total / take) };
  }

  /**
   * Manager / Admin Review (Approve or Reject)
   */
  async reviewRequest(requestId, organizationId, reviewerUserId, { status, reviewNote }) {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Invalid status. Must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const correction = await prisma.attendanceCorrection.findFirst({
      where: { id: requestId, organizationId },
      include: {
        employee: {
          include: { branch: true, shift: true },
        },
      },
    });

    if (!correction) {
      const error = new Error("Correction request not found");
      error.statusCode = 404;
      throw error;
    }

    if (correction.status !== "PENDING") {
      const error = new Error(`Request has already been ${correction.status.toLowerCase()}`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.$transaction(async (tx) => {
      // If approved, update target Attendance record
      if (status === "APPROVED") {
        const employee = correction.employee;
        let shift = employee.shift;
        if (!shift) {
          shift = await tx.shift.findFirst({
            where: { organizationId },
            orderBy: { createdAt: "asc" },
          });
        }

        const checkIn = correction.requestedCheckIn;
        const checkOut = correction.requestedCheckOut;

        let workingMinutes = 0;
        let lateMinutes = 0;
        let earlyMinutes = 0;
        let overtimeMinutes = 0;
        let attendanceStatus = "PRESENT";

        if (shift && checkIn && checkOut) {
          const metrics = evaluateAttendanceAgainstShift(shift, checkIn, checkOut);
          workingMinutes = metrics.workingMinutes;
          lateMinutes = metrics.lateMinutes;
          earlyMinutes = metrics.earlyMinutes;
          overtimeMinutes = metrics.overtimeMinutes;
          attendanceStatus = metrics.status;
        } else if (shift && checkIn) {
          lateMinutes = calculateLateMinutes(shift.startTime, shift.graceMinutes, checkIn);
          attendanceStatus = lateMinutes > 0 ? "LATE" : "PRESENT";
        }

        const attendance = await tx.attendance.upsert({
          where: {
            employeeId_date: {
              employeeId: employee.id,
              date: correction.date,
            },
          },
          update: {
            checkIn: checkIn || undefined,
            checkOut: checkOut || undefined,
            workingMinutes,
            lateMinutes,
            earlyMinutes,
            overtimeMinutes,
            status: attendanceStatus,
          },
          create: {
            organizationId,
            employeeId: employee.id,
            branchId: employee.branchId || null,
            shiftId: shift?.id || null,
            date: correction.date,
            checkIn: checkIn || null,
            checkOut: checkOut || null,
            workingMinutes,
            lateMinutes,
            earlyMinutes,
            overtimeMinutes,
            status: attendanceStatus,
          },
        });

        // Link attendance to correction
        await tx.attendanceCorrection.update({
          where: { id: requestId },
          data: { attendanceId: attendance.id },
        });
      }

      const updated = await tx.attendanceCorrection.update({
        where: { id: requestId },
        data: {
          status,
          reviewedBy: reviewerUserId,
          reviewNote: reviewNote || null,
        },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
          },
          attendance: true,
        },
      });

      return updated;
    });
  }
}

module.exports = new CorrectionService();
