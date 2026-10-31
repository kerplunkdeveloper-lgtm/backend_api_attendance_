const prisma = require("../config/database");
const { parsePagination } = require("../utils/pagination");
const { getOrgDateOnly } = require("./attendance.service");
const { assertCanReview, visibleToReviewer } = require("../utils/approvalChain");
const webhookService = require("./webhook.service");

class OvertimeService {
  /** Parse a calendar date without allowing the server timezone to shift it. */
  async _attendanceDate(organizationId, value) {
    const raw = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
    }
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime())) return null;
    return getOrgDateOnly(organizationId, instant);
  }

  /**
   * Minutes of overtime an employee may legitimately claim for a punch record.
   *
   * When the org requires OT approval, checkout parks the minutes on a pending
   * request and writes 0 to the attendance row, so fall back to the pending
   * request's figure rather than reading the (zeroed) attendance column.
   */
  async _computeEligibleOvertime(attendance) {
    if (attendance.overtimeMinutes > 0) return attendance.overtimeMinutes;

    const autoRaised = await prisma.overtimeRequest.findFirst({
      where: { attendanceId: attendance.id },
      orderBy: { createdAt: "desc" },
      select: { requestedMinutes: true },
    });
    return autoRaised?.requestedMinutes ?? 0;
  }

  /**
   * Employee requests overtime approval for a specific attendance date
   */
  async requestOvertime(organizationId, userId, payload = {}) {
    let { attendanceId, requestedMinutes, reason, date, hours } = payload;

    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    if (!requestedMinutes && hours != null) {
      requestedMinutes = Math.round(Number(hours) * 60);
    }

    if (!attendanceId && date) {
      const dateOnly = await this._attendanceDate(organizationId, date);
      if (!dateOnly) {
        const error = new Error("Enter a valid overtime date");
        error.statusCode = 400;
        throw error;
      }
      const byDate = await prisma.attendance.findFirst({
        where: { employeeId: employee.id, organizationId, date: dateOnly },
      });
      attendanceId = byDate?.id;
    }

    if (!requestedMinutes) {
      const error = new Error("attendanceId (or date) and requestedMinutes (or hours) are required");
      error.statusCode = 400;
      throw error;
    }

    if (!attendanceId) {
      const error = new Error("No attendance record was found for the selected date. Punch in and out first, then request overtime.");
      error.statusCode = 404;
      error.code = "ATTENDANCE_NOT_FOUND_FOR_DATE";
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
      const error = new Error("Cannot request overtime before punching out");
      error.statusCode = 400;
      throw error;
    }

    // A punch can only be paid once. A rejected request may be corrected and
    // submitted again, but an approved request must never be duplicated.
    const existing = await prisma.overtimeRequest.findFirst({
      where: { attendanceId, status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      const error = new Error(
        existing.status === "APPROVED"
          ? "Overtime for this punch has already been approved"
          : "A pending overtime request already exists for this date"
      );
      error.statusCode = 400;
      throw error;
    }

    // Overtime can only be claimed for time actually worked beyond the shift.
    // The worked figure comes from the punch record, so it cannot be inflated.
    const workedOvertime = await this._computeEligibleOvertime(attendance);
    const requested = parseInt(requestedMinutes, 10);

    if (!Number.isFinite(requested) || requested <= 0) {
      const error = new Error("requestedMinutes must be a positive number");
      error.statusCode = 400;
      throw error;
    }

    if (workedOvertime <= 0) {
      const error = new Error("No overtime was recorded for this date");
      error.statusCode = 400;
      throw error;
    }

    if (requested > workedOvertime) {
      const error = new Error(
        `You can claim at most ${workedOvertime} minute(s) of overtime for this date.`
      );
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.overtimeRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        attendanceId,
        requestedMinutes: requested,
        reason: reason || null,
        status: "PENDING",
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        attendance: { select: { id: true, date: true, workingMinutes: true, overtimeMinutes: true } },
      },
    });

    void require("./notification.service").notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: "New overtime request",
      summary: `requested ${requested} minute(s) of overtime.`,
    });

    return { success: true, message: "Overtime request submitted for approval", request };
  }

  /**
   * Manager/Admin reviews (approve/reject) an overtime request
   */
  async reviewOvertimeRequest(organizationId, requestId, reviewerUserId, { status, approvedMinutes, reviewNote, reviewerRole }) {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Status must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.overtimeRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { attendance: true, employee: { select: { userId: true, user: { select: { role: true } } } } },
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
    if (request.employee?.userId && request.employee.userId === reviewerUserId) {
      const error = new Error("You cannot review your own overtime request");
      error.statusCode = 403;
      throw error;
    }
    assertCanReview(request.employee?.user?.role, reviewerRole);

    const finalOtMinutes =
      approvedMinutes !== undefined && approvedMinutes !== null
        ? parseInt(approvedMinutes, 10)
        : request.requestedMinutes;

    if (status === "APPROVED" && (!Number.isFinite(finalOtMinutes) || finalOtMinutes < 0)) {
      const error = new Error("approvedMinutes must be zero or a positive number");
      error.statusCode = 400;
      throw error;
    }

    // Approval can shorten a claim but never grow it: payroll pays these minutes, so a typo or a
    // padded figure here would be paid out even though the punch record never supported it.
    if (status === "APPROVED" && finalOtMinutes > request.requestedMinutes) {
      const error = new Error(`You can approve at most ${request.requestedMinutes} minute(s), the amount requested.`);
      error.statusCode = 400;
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
      if (status === "APPROVED") {
        await tx.attendance.update({
          where: { id: request.attendanceId },
          data: { overtimeMinutes: finalOtMinutes },
        });
      } else {
        // Rejection withdraws only the minutes under review. Blanket-zeroing the
        // column also erased overtime that was never part of this request.
        const remaining = Math.max(
          0,
          (request.attendance?.overtimeMinutes || 0) - request.requestedMinutes
        );
        await tx.attendance.update({
          where: { id: request.attendanceId },
          data: { overtimeMinutes: remaining },
        });
      }

      const updated = await tx.overtimeRequest.update({
        where: { id: requestId },
        data: {
          status,
          approvedMinutes: status === "APPROVED" ? finalOtMinutes : null,
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
    if (request.employee?.userId && prisma.notification?.create) {
      try {
        await prisma.notification.create({
          data: {
            organizationId,
            userId: request.employee.userId,
            title: `Overtime request ${status.toLowerCase()}`,
            message: `Your overtime request was ${status.toLowerCase()}${reviewNote ? `: ${reviewNote}` : "."}`,
            type: "OVERTIME",
          },
        });
      } catch (error) {
        console.warn("[OvertimeNotification] Dispatch failed:", error.message);
      }
    }
    webhookService.dispatch(organizationId, "attendance.updated", {
      overtimeRequestId: requestId,
      employeeId: request.employeeId,
      status,
      approvedMinutes: status === "APPROVED" ? finalOtMinutes : null,
    }).catch((error) => console.warn("[OvertimeNotification:Webhook] Dispatch failed:", error.message));
    return result;
  }

  /**
   * Get all overtime requests for the organization (admin/manager view)
   */
  async getOvertimeRequests(organizationId, query = {}, reviewerRole) {
    const { status, employeeId, page = 1, limit = 50 } = query;
    // Authenticated requests always carry a role. Keep the service usable by
    // legacy callers/tests that do not provide one, while still enforcing the
    // visibility rule whenever a role is known.
    const where = {
      organizationId,
      ...(reviewerRole == null ? {} : visibleToReviewer(reviewerRole)),
    };
    if (status && status !== "ALL") where.status = status;
    if (employeeId) where.employeeId = employeeId;

    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

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

    return { records, total, page: curPage, totalPages: Math.ceil(total / take) };
  }

  /**
   * Get employee's own overtime requests
   */
  async getMyOvertimeRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return [];

    return await prisma.overtimeRequest.findMany({
      take: 500, // safety cap: a person's own history can grow for years
      where: { employeeId: employee.id, organizationId },
      include: { attendance: { select: { id: true, date: true, workingMinutes: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}

module.exports = new OvertimeService();
