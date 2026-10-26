const { assertCanReview, visibleToReviewer } = require("../utils/approvalChain");
const prisma = require("../config/database");
const { parsePagination } = require("../utils/pagination");
const { evaluateAttendanceAgainstShift, calculateLateMinutes } = require("../utils/shiftCalculator");
const { getOrgDateOnly, resolveShift } = require("./attendance.service");
const notificationService = require("./notification.service");

const parseRequestedTimestamp = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    const error = new Error(
      `${fieldName} must be a complete ISO date-time, for example 2026-09-29T09:30:00.000Z`,
    );
    error.statusCode = 400;
    throw error;
  }
  return timestamp;
};

const assertPayrollMonthUnlocked = async (organizationId, date) => {
  const target = new Date(date);
  const month = target.getUTCMonth() + 1;
  const year = target.getUTCFullYear();
  const locked = await prisma.payslip.findFirst({
    where: {
      organizationId,
      month,
      year,
      status: { in: ["APPROVED", "DISBURSED"] },
    },
    select: { id: true },
  });
  if (locked) {
    const error = new Error("Attendance cannot be corrected for a month with a locked payslip.");
    error.statusCode = 409;
    throw error;
  }
};

class CorrectionService {
  /**
   * Submit an attendance regularization/correction request
   */
  async createCorrectionRequest(userId, organizationId, data) {
    const { date, requestedCheckIn, requestedCheckOut, reason, attendanceId } = data;

    if (!date || !String(reason || "").trim()) {
      const error = new Error("Date and reason are required for attendance correction");
      error.statusCode = 400;
      throw error;
    }

    const submittedDate = new Date(date);
    if (Number.isNaN(submittedDate.getTime())) {
      const error = new Error("Date must be a valid ISO date");
      error.statusCode = 400;
      throw error;
    }

    const checkIn = parseRequestedTimestamp(requestedCheckIn, "requestedCheckIn");
    const checkOut = parseRequestedTimestamp(requestedCheckOut, "requestedCheckOut");

    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) {
      const error = new Error("Active employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    // The client sends the attendance row's date (UTC midnight of the local calendar day). Converting that
    // instant into the tenant's timezone would move it to the previous day for any zone behind UTC.
    const dayPrefix = typeof date === "string" ? date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] : null;
    const targetDate = dayPrefix ? new Date(`${dayPrefix}T00:00:00.000Z`) : await getOrgDateOnly(organizationId, submittedDate);

    const today = await getOrgDateOnly(organizationId, new Date());
    if (targetDate.getTime() > today.getTime()) {
      const error = new Error("Attendance can only be corrected for today or an earlier date");
      error.statusCode = 400;
      throw error;
    }
    if (!checkIn && !checkOut) {
      const error = new Error("Enter the corrected punch-in time, punch-out time, or both");
      error.statusCode = 400;
      throw error;
    }
    if (checkIn && checkOut && checkOut.getTime() <= checkIn.getTime()) {
      const error = new Error("Punch-out time must be after punch-in time");
      error.statusCode = 400;
      throw error;
    }
    await assertPayrollMonthUnlocked(organizationId, targetDate);

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
        requestedCheckIn: checkIn,
        requestedCheckOut: checkOut,
        reason: String(reason).trim(),
        status: "PENDING",
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });

    // Admins and HR are told straight away with clear punch times & reason.
    const inTimeStr = checkIn ? new Date(checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    const outTimeStr = checkOut ? new Date(checkOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    const timesPart = inTimeStr && outTimeStr
      ? `(Check-in: ${inTimeStr}, Check-out: ${outTimeStr})`
      : inTimeStr
      ? `(Check-in: ${inTimeStr})`
      : outTimeStr
      ? `(Check-out: ${outTimeStr})`
      : "";

    void notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: "Attendance Correction Request",
      summary: `requested attendance correction for ${targetDate.toISOString().slice(0, 10)} ${timesPart}. Reason: ${String(reason).trim().slice(0, 120)}`,
      type: "APPROVAL",
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
  async getAllRequests(organizationId, query = {}, reviewerRole = "COMPANY_ADMIN") {
    const { status, employeeId, page = 1, limit = 50 } = query;
    const visible = { organizationId, ...visibleToReviewer(reviewerRole) };
    const where = { ...visible };

    if (status && status !== "ALL") {
      where.status = status;
    }
    if (employeeId) {
      where.employeeId = employeeId;
    }

    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

    const [records, total, grouped] = await Promise.all([
      prisma.attendanceCorrection.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { name: true } },
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
      // Counts ignore the status filter, so the Pending / Approved / Rejected chips always show real totals.
      prisma.attendanceCorrection.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    ]);

    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;

    return { records, total, page: curPage, totalPages: Math.ceil(total / take), counts };
  }

  /**
   * Manager / Admin Review (Approve or Reject)
   */
  async reviewRequest(requestId, organizationId, reviewerUserId, { status, reviewNote }, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Invalid status. Must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const correction = await prisma.attendanceCorrection.findFirst({
      where: { id: requestId, organizationId },
      include: {
        employee: {
          include: { branch: true, shift: true, user: { select: { role: true } } },
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

    if (correction.employee?.userId && correction.employee.userId === reviewerUserId) {
      const error = new Error("You cannot review your own attendance correction");
      error.statusCode = 403;
      throw error;
    }

    assertCanReview(correction.employee?.user?.role, reviewerRole);

    if (status === "APPROVED") {
      await assertPayrollMonthUnlocked(organizationId, correction.date);
    }

    const reviewed = await prisma.$transaction(async (tx) => {
      // If approved, update target Attendance record
      if (status === "APPROVED") {
        const employee = correction.employee;
        const shift = await resolveShift(employee, organizationId, correction.date);

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

    // Tell the employee how it was decided.
    if (correction.employee?.userId) {
      void notificationService
        .createNotification({
          organizationId,
          userId: correction.employee.userId,
          title: `Regularization ${status.toLowerCase()}`,
          message:
            `Your punch correction for ${correction.date.toISOString().slice(0, 10)} was ${status.toLowerCase()}.` +
            (reviewNote ? ` Note: ${reviewNote}` : ""),
          type: "REGULARIZATION",
        })
        .catch((err) => console.warn("[CorrectionNotification] Employee alert failed:", err.message));
    }

    return reviewed;
  }
}

module.exports = new CorrectionService();
