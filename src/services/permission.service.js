const prisma = require("../config/database");
const { getLocalDateOnly, getLocalMinutesOfDay } = require("../utils/datetime");
const policyService = require("./policy.service");
const leaveService = require("./leave.service");
const notificationService = require("./notification.service");
const { assertCanReview } = require("../utils/approvalChain");
const { getPayrollPeriod, normalizePermissionHours, toIsoKey, round2 } = require("../utils/payrollCycle");
const { officeOnlyRejection, hasCoordinatePair } = require("../utils/geofence");

const REVIEW_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/** "YYYY-MM-DD" to a UTC date-only value. Rejects anything that is not a real calendar date. */
const parseDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw httpError("Date must be in YYYY-MM-DD format", 400);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toIsoKey(date) !== `${match[1]}-${match[2]}-${match[3]}`) throw httpError("Date is not a valid calendar day", 400);
  return date;
};
const parseTime = (value, field) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) throw httpError(`${field} must be in HH:mm format`, 400);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59 || minute % 15 !== 0) throw httpError(`${field} must be a valid time in 15-minute steps`, 400);
  return hour * 60 + minute;
};

const formatHours = (minutes) => Math.round((minutes / 60) * 100) / 100;

const parseCoordinate = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < -90 || number > 90) throw httpError(`${label} is not valid`, 400);
  return number;
};

// Permission times are displayed and enforced in India Standard Time, never in the
// Railway process timezone or a browser's local timezone.
const PERMISSION_TIMEZONE = "Asia/Kolkata";
const getPermissionDateOnly = (date = new Date()) => getLocalDateOnly(date, PERMISSION_TIMEZONE);

const assertInsideOffice = async (organizationId, latitude, longitude, accuracy) => {
  const lat = parseCoordinate(latitude, "Latitude");
  const lng = Number(longitude);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw httpError("Longitude is not valid", 400);

  const branches = (await prisma.branch.findMany({
    where: { organizationId },
    select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true },
  })).filter(hasCoordinatePair);

  if (!branches.length) throw Object.assign(httpError("Your office location is not configured yet. Ask HR to set the branch GPS location before starting permission time.", 409), { code: "OFFICE_LOCATION_NOT_CONFIGURED" });

  const rejection = officeOnlyRejection({ latitude: lat, longitude: lng, accuracy, branches, allowWfh: false });
  if (rejection) throw Object.assign(httpError(rejection.message, 403), { code: rejection.code, details: rejection.details });

  const matched = branches.find((branch) => !officeOnlyRejection({ latitude: lat, longitude: lng, accuracy: 0, branches: [branch] }));
  return { latitude: lat, longitude: lng, branch: matched || branches[0] };
};

/**
 * The payroll cycle that contains `today`. Its label is the month the cycle ends in, so the
 * candidates are the months around today's month.
 */
const findCycleContaining = (today, startDay, endDay) => {
  const base = new Date(today);
  for (const offset of [0, 1, -1]) {
    const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
    const month = candidate.getUTCMonth() + 1;
    const year = candidate.getUTCFullYear();
    const period = getPayrollPeriod(month, year, startDay, endDay);
    if (today >= period.start && today <= period.end) return { month, year, period };
  }
  const period = getPayrollPeriod(base.getUTCMonth() + 1, base.getUTCFullYear(), startDay, endDay);
  return { month: base.getUTCMonth() + 1, year: base.getUTCFullYear(), period };
};

class PermissionService {
  async _employeeForUser(organizationId, userId) {
    const employee = await prisma.employee.findFirst({
      where: { organizationId, userId, deletedAt: null },
      include: { user: { select: { role: true } } },
    });
    if (!employee) throw httpError("No employee profile is linked to this account", 404);
    return employee;
  }

  /** Throws if a payslip covering this date is already approved or paid, because its figures are final. */
  async _assertCycleOpen(organizationId, employeeId, date) {
    const locked = await prisma.payslip.findFirst({
      where: {
        organizationId,
        employeeId,
        status: { in: ["APPROVED", "DISBURSED"] },
        periodStart: { lte: date },
        periodEnd: { gte: date },
      },
      select: { id: true },
    });
    if (locked) {
      throw httpError("The payroll for this cycle is already approved, so permissions for it can no longer change", 409);
    }
  }

  /**
   * Employee applies for a short permission on a working day.
   */
  async apply(organizationId, userId, data = {}) {
    const employee = await this._employeeForUser(organizationId, userId);
    const date = parseDateOnly(data.date);
const hasTimeRange = data.startTime !== undefined || data.endTime !== undefined;
    let startTime = null;
    let endTime = null;
    let hours;
    if (hasTimeRange) {
      if (!data.startTime || !data.endTime) throw httpError("Start time and end time are required", 400);
      const startMinutes = parseTime(data.startTime, "Start time");
      const endMinutes = parseTime(data.endTime, "End time");
      if (endMinutes <= startMinutes) throw httpError("End time must be after start time", 400);
      startTime = String(data.startTime);
      endTime = String(data.endTime);
      hours = normalizePermissionHours(formatHours(endMinutes - startMinutes));
    } else {
      hours = normalizePermissionHours(data.hours);
    }
    const reason = String(data.reason || "").trim();
    if (!reason) throw httpError("Give a reason for the permission", 400);
    if (reason.length > 500) throw httpError("Reason must be 500 characters or fewer", 400);

    const today = getPermissionDateOnly();
    if (date.getTime() < today.getTime()) throw httpError("A permission cannot be requested for a past date", 400);

    const eligibility = await leaveService.getEligibilityForEmployee(employee, organizationId);
    if (!eligibility.eligible) {
      throw httpError(`Permissions open after probation, on ${toIsoKey(eligibility.eligibleFrom)}`, 403);
    }

    await this._assertCycleOpen(organizationId, employee.id, date);

    const request = await prisma.permissionRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        date,
        startTime,
        endTime,
        hours,
        reason,
      },
    });

    void notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: "New permission request",
      summary: `asked for ${hours} hour(s) of permission on ${new Date(date).toISOString().slice(0, 10)}${startTime && endTime ? ` (${startTime}-${endTime})` : ""}.`,
    });

    return request;
  }

  /**
   * My permissions and the allowance left in the payroll cycle that contains today.
   */
  async listMine(organizationId, userId) {
    const employee = await this._employeeForUser(organizationId, userId);
    const policy = await policyService.getPolicy(organizationId);
    const today = getPermissionDateOnly();
    const cycle = findCycleContaining(today, policy.payrollCycleStartDay, policy.payrollCycleEndDay);

    const [requests, approved, overtimePermission] = await Promise.all([
      prisma.permissionRequest.findMany({
        where: { organizationId, employeeId: employee.id },
        orderBy: { date: "desc" },
        take: 100,
      }),
      prisma.permissionRequest.aggregate({
        where: {
          organizationId,
          employeeId: employee.id,
          status: "APPROVED",
          date: { gte: cycle.period.start, lte: cycle.period.end },
        },
        _sum: { hours: true },
      }),
      prisma.overtimeAllocation.aggregate({
        where: { organizationId, employeeId: employee.id, month: cycle.month, year: cycle.year, status: "APPROVED" },
        _sum: { permissionMinutes: true },
      }),
    ]);

    const overtimePermissionMinutes = Number(overtimePermission._sum.permissionMinutes || 0);
    const allowanceHours = Number(policy.monthlyPermissionHours || 0) + overtimePermissionMinutes / 60;
    const usedHours = Number(approved._sum.hours || 0);
    const allowanceMinutes = Math.round(allowanceHours * 60);
    const usedMinutes = Math.round(usedHours * 60);
    return {
      requests,
      allowance: {
        cycleStart: toIsoKey(cycle.period.start),
        cycleEnd: toIsoKey(cycle.period.end),
        allowanceHours,
        allowanceMinutes,
        overtimePermissionMinutes,
        usedHours: round2(usedHours),
        usedMinutes,
        remainingHours: round2(Math.max(0, allowanceHours - usedHours)),
        remainingMinutes: Math.max(0, allowanceMinutes - usedMinutes),
        excessHours: round2(Math.max(0, usedHours - allowanceHours)),
        excessMinutes: Math.max(0, usedMinutes - allowanceMinutes),
      },
    };
  }

  /**
   * Requests for review. Admins and HR see the whole organization.
   */
  async listForReview(organizationId, query = {}) {
    const where = { organizationId };
    if (["PENDING", "APPROVED", "REJECTED"].includes(query.status)) where.status = query.status;
    if (query.employeeId) where.employeeId = String(query.employeeId);

    return prisma.permissionRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
      orderBy: [{ status: "asc" }, { date: "desc" }],
      take: 200,
    });
  }

  /**
   * Approve or reject a pending request. Employees cannot approve their own requests.
   */
  async review(organizationId, requestId, data = {}, actor = {}) {
    if (!REVIEW_ROLES.includes(actor.role)) throw httpError("Only admins and HR can review permissions", 403);
    if (!["APPROVED", "REJECTED"].includes(data.status)) throw httpError("Status must be APPROVED or REJECTED", 400);

    const request = await prisma.permissionRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { employee: { include: { user: { select: { role: true } } } } },
    });
    if (!request) throw httpError("Permission request not found", 404);
    if (request.status !== "PENDING") throw httpError(`This request is already ${request.status.toLowerCase()}`, 409);
    if (request.employee.userId && request.employee.userId === actor.id) {
      throw httpError("You cannot review your own permission request", 403);
    }
    assertCanReview(request.employee.user?.role, actor.role);

    if (data.status === "APPROVED") {
      await this._assertCycleOpen(organizationId, request.employeeId, request.date);
    }

    const updated = await prisma.permissionRequest.update({
      where: { id: request.id },
      data: {
        status: data.status,
        reviewedBy: actor.id || null,
        reviewNote: data.note ? String(data.note).trim().slice(0, 500) : null,
      },
    });

    if (request.employee.userId) {
      const dateLabel = toIsoKey(request.date);
      const approved = data.status === "APPROVED";
      notificationService
        .createNotification({
          organizationId,
          userId: request.employee.userId,
          title: approved ? "Permission approved" : "Permission rejected",
          message: `Your ${Number(request.hours)} hour permission for ${dateLabel}${request.startTime && request.endTime ? ` (${request.startTime}-${request.endTime})` : ""} was ${approved ? "approved" : "rejected"}.`,
          type: "SYSTEM",
        })
        .catch((err) => console.warn("[Permission] Notification failed:", err.message));
    }

    return updated;
  }

  async _approvedPermissionForUser(organizationId, userId, requestId) {
    const employee = await this._employeeForUser(organizationId, userId);
    const request = await prisma.permissionRequest.findFirst({
      where: { id: requestId, organizationId, employeeId: employee.id },
    });
    if (!request) throw httpError("Permission request not found", 404);
    if (request.status !== "APPROVED") throw httpError("Only an approved permission can be started", 403);
    return { employee, request };
  }

  async _assertPermissionWindow(organizationId, request, now, { requireWindow = true } = {}) {
    const today = getPermissionDateOnly(now);
    if (toIsoKey(today) !== toIsoKey(request.date)) throw httpError("This permission is not scheduled for today", 409);

    if (!requireWindow || !request.startTime || !request.endTime) return;
    const currentMinutes = getLocalMinutesOfDay(now, PERMISSION_TIMEZONE);
    const [startHour, startMinute] = request.startTime.split(":").map(Number);
    const [endHour, endMinute] = request.endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
      throw httpError(`Permission can be started between ${request.startTime} and ${request.endTime}`, 409);
    }
  }

  async startSession(organizationId, userId, requestId, data = {}) {
    const { employee, request } = await this._approvedPermissionForUser(organizationId, userId, requestId);
    if (request.startedAt && !request.endedAt) throw httpError("Permission time is already running", 409);
    if (request.endedAt) throw httpError("This permission has already been completed", 409);
    await this._assertPermissionWindow(organizationId, request, new Date());

    const active = await prisma.permissionRequest.findFirst({
      where: { organizationId, employeeId: employee.id, status: "APPROVED", startedAt: { not: null }, endedAt: null, id: { not: request.id } },
      select: { id: true },
    });
    if (active) throw httpError("Another permission session is already running", 409);

    const location = await assertInsideOffice(organizationId, data.latitude, data.longitude, data.accuracy);
    return prisma.permissionRequest.update({
      where: { id: request.id },
      data: {
        startedAt: new Date(),
        startLatitude: location.latitude,
        startLongitude: location.longitude,
        startLocation: data.locationLabel ? String(data.locationLabel).slice(0, 250) : location.branch.name,
      },
    });
  }

  async endSession(organizationId, userId, requestId, data = {}) {
    const { request } = await this._approvedPermissionForUser(organizationId, userId, requestId);
    if (!request.startedAt) throw httpError("Start the approved permission before ending it", 409);
    if (request.endedAt) throw httpError("Permission time is already completed", 409);
    const now = new Date();
    await this._assertPermissionWindow(organizationId, request, now, { requireWindow: false });
    if (now.getTime() <= new Date(request.startedAt).getTime()) throw httpError("End time must be after the start time", 409);

    const location = await assertInsideOffice(organizationId, data.latitude, data.longitude, data.accuracy);
    return prisma.permissionRequest.update({
      where: { id: request.id },
      data: {
        endedAt: now,
        endLatitude: location.latitude,
        endLongitude: location.longitude,
        endLocation: data.locationLabel ? String(data.locationLabel).slice(0, 250) : location.branch.name,
      },
    });
  }

  /**
   * Employee withdraws a request that is still pending.
   */
  async cancel(organizationId, userId, requestId) {
    const employee = await this._employeeForUser(organizationId, userId);
    const request = await prisma.permissionRequest.findFirst({
      where: { id: requestId, organizationId, employeeId: employee.id },
    });
    if (!request) throw httpError("Permission request not found", 404);
    if (request.status !== "PENDING") throw httpError("Only pending requests can be withdrawn", 409);
    await prisma.permissionRequest.delete({ where: { id: request.id } });
    return { id: request.id };
  }
}

module.exports = new PermissionService();
