const prisma = require("../config/database");
const { getOrgDateOnly } = require("./attendance.service");
const policyService = require("./policy.service");
const leaveService = require("./leave.service");
const notificationService = require("./notification.service");
const { assertCanReview } = require("../utils/approvalChain");
const { getPayrollPeriod, normalizePermissionHours, toIsoKey, round2 } = require("../utils/payrollCycle");

const REVIEW_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"];

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/** "YYYY-MM-DD" to a UTC date-only value. Rejects anything that is not a real calendar date. */
const parseDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw httpError("Date must be in YYYY-MM-DD format", 400);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toIsoKey(date) !== `${match[1]}-${match[2]}-${match[3]}`) throw httpError("Date is not a valid calendar day", 400);
  return date;
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
    const hours = normalizePermissionHours(data.hours);
    const reason = String(data.reason || "").trim();
    if (!reason) throw httpError("Give a reason for the permission", 400);
    if (reason.length > 500) throw httpError("Reason must be 500 characters or fewer", 400);

    const today = await getOrgDateOnly(organizationId);
    if (date.getTime() < today.getTime()) throw httpError("A permission cannot be requested for a past date", 400);

    const eligibility = await leaveService.getEligibilityForEmployee(employee, organizationId);
    if (!eligibility.eligible) {
      throw httpError(`Permissions open after probation, on ${toIsoKey(eligibility.eligibleFrom)}`, 403);
    }

    await this._assertCycleOpen(organizationId, employee.id, date);

    return prisma.permissionRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        date,
        hours,
        reason,
      },
    });
  }

  /**
   * My permissions and the allowance left in the payroll cycle that contains today.
   */
  async listMine(organizationId, userId) {
    const employee = await this._employeeForUser(organizationId, userId);
    const policy = await policyService.getPolicy(organizationId);
    const today = await getOrgDateOnly(organizationId);
    const cycle = findCycleContaining(today, policy.payrollCycleStartDay, policy.payrollCycleEndDay);

    const [requests, approved] = await Promise.all([
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
    ]);

    const allowanceHours = Number(policy.monthlyPermissionHours || 0);
    const usedHours = Number(approved._sum.hours || 0);
    return {
      requests,
      allowance: {
        cycleStart: toIsoKey(cycle.period.start),
        cycleEnd: toIsoKey(cycle.period.end),
        allowanceHours,
        usedHours: round2(usedHours),
        remainingHours: round2(Math.max(0, allowanceHours - usedHours)),
        excessHours: round2(Math.max(0, usedHours - allowanceHours)),
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
          message: `Your ${Number(request.hours)} hour permission for ${dateLabel} was ${approved ? "approved" : "rejected"}.`,
          type: "SYSTEM",
        })
        .catch((err) => console.warn("[Permission] Notification failed:", err.message));
    }

    return updated;
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
