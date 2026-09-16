const prisma = require("../config/database");

class OvertimeService {
  /**
   * Employee requests overtime approval for a specific attendance date
   */
  async requestOvertime(organizationId, userId, { attendanceId, requestedMinutes, reason }) {
    if (!attendanceId || !requestedMinutes) {
      const error = new Error("attendanceId and requestedMinutes are required");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    const attendance = await prisma.attendance.findFirst({
      where: { id: attendanceId, employeeId: employee.id, organizationId },
    });
    if (!attendance) {
      const error = new Error("Attendance record not found");
      error.statusCode = 404;
      throw error;
    }
    if (!attendance.checkOut) {
      const error = new Error("Cannot request overtime before checking out");
      error.statusCode = 400;
      throw error;
    }

    // Check for existing pending OT request for same attendance
    const existing = await prisma.overtimeRequest.findFirst({
      where: { attendanceId, status: "PENDING" },
    });
    if (existing) {
      const error = new Error("A pending overtime request already exists for this date");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.overtimeRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        attendanceId,
        requestedMinutes: parseInt(requestedMinutes),
        reason: reason || null,
        status: "PENDING",
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        attendance: { select: { id: true, date: true, workingMinutes: true, overtimeMinutes: true } },
      },
    });

    return { success: true, message: "Overtime request submitted for approval", request };
  }

  /**
   * Manager/Admin reviews (approve/reject) an overtime request
   */
  async reviewOvertimeRequest(organizationId, requestId, reviewerUserId, { status, approvedMinutes, reviewNote }) {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Status must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.overtimeRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { attendance: true },
    });

    if (!request) {
      const error = new Error("Overtime request not found");
      error.statusCode = 404;
      throw error;
    }
    if (request.status !== "PENDING") {
      const error = new Error(`Request has already been ${request.status.toLowerCase()}`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.$transaction(async (tx) => {
      // If approved, update overtime minutes on the attendance record
      if (status === "APPROVED") {
        const finalOtMinutes = approvedMinutes !== undefined
          ? parseInt(approvedMinutes)
          : request.requestedMinutes;

        await tx.attendance.update({
          where: { id: request.attendanceId },
          data: { overtimeMinutes: finalOtMinutes },
        });
      } else {
        // Rejected: zero out overtime on the attendance record
        await tx.attendance.update({
          where: { id: request.attendanceId },
          data: { overtimeMinutes: 0 },
        });
      }

      const updated = await tx.overtimeRequest.update({
        where: { id: requestId },
        data: {
          status,
          approvedMinutes: status === "APPROVED" ? (approvedMinutes !== undefined ? parseInt(approvedMinutes) : request.requestedMinutes) : null,
          reviewedBy: reviewerUserId,
          reviewNote: reviewNote || null,
        },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          attendance: { select: { id: true, date: true, overtimeMinutes: true } },
        },
      });

      return { success: true, message: `Overtime request ${status.toLowerCase()}`, request: updated };
    });
  }

  /**
   * Get all overtime requests for the organization (admin/manager view)
   */
  async getOvertimeRequests(organizationId, query = {}) {
    const { status, employeeId, page = 1, limit = 50 } = query;
    const where = { organizationId };
    if (status && status !== "ALL") where.status = status;
    if (employeeId) where.employeeId = employeeId;

    const take = parseInt(limit) || 50;
    const skip = ((parseInt(page) || 1) - 1) * take;

    const [records, total] = await Promise.all([
      prisma.overtimeRequest.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          attendance: { select: { id: true, date: true, workingMinutes: true, overtimeMinutes: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.overtimeRequest.count({ where }),
    ]);

    return { records, total, page: parseInt(page), totalPages: Math.ceil(total / take) };
  }

  /**
   * Get employee's own overtime requests
   */
  async getMyOvertimeRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return [];

    return await prisma.overtimeRequest.findMany({
      where: { employeeId: employee.id, organizationId },
      include: { attendance: { select: { id: true, date: true, workingMinutes: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}

module.exports = new OvertimeService();
