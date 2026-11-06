const prisma = require("../config/database");
const notificationDelivery = require("./notification-delivery.service");
const { parsePagination } = require("../utils/pagination");
const { getOrgDateOnly, getOrgTimezone } = require("./attendance.service");
const { getLocalMinutesOfDay, parseTimeToMinutes } = require("../utils/datetime");
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

  /** Start a separately tracked overtime session only after its request is approved. */
  async startOvertimeSession(organizationId, userId, reason) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    const now = new Date();
    const attendanceDate = await getOrgDateOnly(organizationId, now);
    const attendance = await prisma.attendance.findFirst({
      where: { employeeId: employee.id, organizationId, date: attendanceDate },
    });

    if (!attendance?.checkIn || !attendance.checkOut) {
      const error = new Error("Complete your regular punch-in and punch-out before starting overtime");
      error.statusCode = 400;
      throw error;
    }

    const openSession = await prisma.overtimeRequest.findFirst({
      where: { organizationId, employeeId: employee.id, attendanceId: attendance.id, status: "APPROVED", otCheckIn: { not: null }, otCheckOut: null },
    });
    if (openSession) {
      const error = new Error("An overtime session is already running. End it before starting another one.");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.overtimeRequest.findFirst({
      where: { organizationId, employeeId: employee.id, attendanceId: attendance.id, status: "APPROVED", otCheckIn: null, otCheckOut: null },
      orderBy: { createdAt: "desc" },
      include: { attendance: { select: { id: true, date: true, checkOut: true } } },
    });
    if (!request) {
      const error = new Error("Overtime approval is required before starting overtime");
      error.statusCode = 403;
      throw error;
    }

    const timezone = await getOrgTimezone(organizationId);
    const plannedStart = parseTimeToMinutes(request.plannedStartTime);
    if (plannedStart !== null && getLocalMinutesOfDay(now, timezone) < plannedStart) {
      const error = new Error(`Overtime can start from ${request.plannedStartTime}`);
      error.statusCode = 400;
      throw error;
    }

    const updated = await prisma.overtimeRequest.update({
      where: { id: request.id },
      data: { otCheckIn: now, ...(reason ? { reason: String(reason).trim() } : {}) },
      include: { attendance: { select: { id: true, date: true, checkOut: true } } },
    });

    return { success: true, message: "Approved overtime started. End it when you finish.", request: updated };
  }

  /** Close a separate overtime session; minutes remain unpaid until reviewed. */
  async endOvertimeSession(organizationId, userId, requestId, reason) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    const request = await prisma.overtimeRequest.findFirst({
      where: { id: requestId, organizationId, employeeId: employee.id, status: "APPROVED", otCheckIn: { not: null }, otCheckOut: null },
    });
    if (!request) {
      const error = new Error("Active overtime session not found");
      error.statusCode = 404;
      throw error;
    }

    const now = new Date();
    const requestedMinutes = Math.floor((now.getTime() - new Date(request.otCheckIn).getTime()) / 60000);
    if (requestedMinutes <= 0) {
      const error = new Error("Overtime must run for at least one minute");
      error.statusCode = 400;
      throw error;
    }

    const approvedLimit = Number(request.approvedMinutes ?? request.requestedMinutes ?? 0);
    const payableMinutes = Math.min(requestedMinutes, approvedLimit || requestedMinutes);
    const updated = await prisma.overtimeRequest.update({
      where: { id: request.id },
      data: {
        requestedMinutes,
        approvedMinutes: payableMinutes,
        otCheckOut: now,
        ...(reason ? { reason: String(reason).trim() } : {}),
      },
      include: { attendance: { select: { id: true, date: true, checkOut: true } } },
    });

    void require("./notification.service").notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: "New overtime session",
      summary: `completed ${requestedMinutes} minute(s) of post-shift overtime awaiting approval.`,
    });

    return { success: true, message: "Overtime ended and sent for approval", request: updated };
  }

  /**
   * Employee requests overtime approval for a specific attendance date
   */
  async requestOvertime(organizationId, userId, payload = {}) {
    let { attendanceId, requestedMinutes, reason, date, hours, startTime, endTime } = payload;

    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    // New SaaS flow: planned OT must be approved before the employee can start it.
    if (date && startTime && endTime) {
      const dateOnly = await this._attendanceDate(organizationId, date);
      const startMinutes = parseTimeToMinutes(startTime);
      const endMinutes = parseTimeToMinutes(endTime);
      if (!dateOnly || startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        const error = new Error("Select a valid overtime date, start time and end time");
        error.statusCode = 400;
        throw error;
      }

      const attendance = await prisma.attendance.findFirst({
        where: { employeeId: employee.id, organizationId, date: dateOnly },
      });
      if (!attendance?.checkIn) {
        const error = new Error("Punch in for the day before requesting overtime");
        error.statusCode = 400;
        throw error;
      }

      const existing = await prisma.overtimeRequest.findFirst({
        where: { attendanceId: attendance.id, status: { in: ["PENDING", "APPROVED"] }, otCheckOut: null },
      });
      if (existing) {
        const error = new Error("An overtime request already exists for this day");
        error.statusCode = 400;
        throw error;
      }

      const plannedMinutes = endMinutes - startMinutes;
      const request = await prisma.overtimeRequest.create({
        data: {
          organizationId,
          employeeId: employee.id,
          attendanceId: attendance.id,
          requestedMinutes: plannedMinutes,
          plannedStartTime: startTime,
          plannedEndTime: endTime,
          reason: reason || "Planned overtime",
          status: "PENDING",
        },
        include: { attendance: { select: { id: true, date: true, checkIn: true, checkOut: true } } },
      });

      void require("./notification.service").notifyReviewersOfRequest({
        organizationId,
        employeeId: employee.id,
        title: "New overtime approval request",
        summary: `requested ${plannedMinutes} minute(s) from ${startTime} to ${endTime}.`,
      });
      return { success: true, message: "Overtime request submitted for approval", request };
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

    const hasApprovedMinutes = approvedMinutes !== undefined && approvedMinutes !== null;
    const finalOtMinutes = hasApprovedMinutes
      ? Number(approvedMinutes)
      : Number(request.requestedMinutes);

    if (
      status === "APPROVED" &&
      (!Number.isInteger(finalOtMinutes) || finalOtMinutes < 0)
    ) {
      const error = new Error("approvedMinutes must be a whole number of minutes (0 or more)");
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
      if (status === "APPROVED" && !request.otCheckIn && !request.plannedStartTime) {
        await tx.attendance.update({
          where: { id: request.attendanceId },
          data: { overtimeMinutes: finalOtMinutes },
        });
      } else if (status === "REJECTED" && !request.otCheckIn && !request.plannedStartTime) {
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
        await notificationDelivery.create({
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
