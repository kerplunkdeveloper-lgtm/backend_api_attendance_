const { assertCanReview, visibleToReviewer } = require("../utils/approvalChain");
const { WORKING_STATUSES } = require("../utils/employeeStatus");
const prisma = require("../config/database");
const { parsePagination } = require("../utils/pagination");
const { getTodayDateOnly, getOrgDateOnly } = require("./attendance.service");
const holidayService = require("./holiday.service");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");
const notificationService = require("./notification.service");
const policyService = require("./policy.service");
const webhookService = require("./webhook.service");

// HR has the same employee-leave management access as a manager. Approval-chain
// rules still keep requests raised by HR/admin accounts admin-only.
const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];

/** Statuses that still occupy leave balance and block an overlapping request. */
const BLOCKING_STATUSES = ["PENDING", "APPROVED"];
const OT_LEAVE_CODE = "OTL";
const isOtLeaveType = (leaveType) => String(leaveType?.code || "").toUpperCase() === OT_LEAVE_CODE;

const toDateKey = (date) => new Date(date).toISOString().split("T")[0];

const monthStartUtc = (date) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
};

const monthEndUtc = (date) => {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
};

const calendarMonthsInclusive = (from, to) => {
  const start = monthStartUtc(from);
  const end = monthStartUtc(to);
  return Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1);
};

const laterDate = (...dates) => dates
  .filter(Boolean)
  .map((date) => new Date(date))
  .reduce((latest, date) => (!latest || date > latest ? date : latest), null);

/**
 * Parses a Shift.workingDays CSV ("1,2,3,4,5" where 0=Sunday) into a Set.
 * Falls back to Mon–Sat when the employee has no shift configured.
 */
const parseWorkingDays = (shift) => {
  const raw = shift?.workingDays;
  if (!raw || typeof raw !== "string") return new Set([1, 2, 3, 4, 5, 6]);
  const parsed = raw
    .split(",")
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return parsed.length ? new Set(parsed) : new Set([1, 2, 3, 4, 5, 6]);
};

/**
 * Walks a date range and classifies every day.
 *
 * Both the application path and the approval path use this so the number of
 * days deducted from the balance always matches the days written to attendance.
 *
 * @returns {{ leaveDays: Date[], holidayDays: Date[], weekOffDays: Date[] }}
 */
const classifyRangeDays = (start, end, holidayDateKeys, workingDaySet) => {
  const leaveDays = [];
  const holidayDays = [];
  const weekOffDays = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const day = new Date(cursor);
    const key = toDateKey(day);

    if (holidayDateKeys.has(key)) {
      holidayDays.push(day);
    } else if (!workingDaySet.has(day.getUTCDay())) {
      weekOffDays.push(day);
    } else {
      leaveDays.push(day);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { leaveDays, holidayDays, weekOffDays };
};

class LeaveService {
  async getMonthlyPaidLeaveStatus({ db = prisma, employee, organizationId, eligibleFrom, leaveDate, excludeRequestId = null, policy, eligibilityActive = true }) {
    const currentLeaveDate = leaveDate || new Date();
    const currentPolicy = policy || await policyService.getPolicy(organizationId);
    const monthlyPaidLeaveDays = Math.max(0, Number(currentPolicy.monthlyPaidLeaveDays ?? 1));
    const carryForward = currentPolicy.paidLeaveCarryForward !== false;
    const eligibleDate = eligibleFrom ? new Date(eligibleFrom) : null;
    if (eligibilityActive && eligibleDate && currentLeaveDate < eligibleDate) {
      return { monthlyAllowance: monthlyPaidLeaveDays, carryForward, accruedDays: 0, usedDays: 0, remainingDays: 0 };
    }
    // Paid leave starts when the employee is brought into WorkPulse, not from
    // the employee's historical joining date. This prevents leave imported
    // from another HR tool from reducing the new monthly allowance.
    const systemStart = employee.paidLeaveStartDate || employee.createdAt || currentLeaveDate;
    const effectiveStart = eligibilityActive ? laterDate(systemStart, eligibleFrom) : systemStart;
    const accrualStart = carryForward ? monthStartUtc(effectiveStart) : monthStartUtc(currentLeaveDate);
    const accrualEnd = monthEndUtc(currentLeaveDate);
    const accruedDays = (carryForward ? calendarMonthsInclusive(accrualStart, accrualEnd) : 1) * monthlyPaidLeaveDays;

    if (accruedDays <= 0) {
      return { monthlyAllowance: monthlyPaidLeaveDays, carryForward, accruedDays: 0, usedDays: 0, remainingDays: 0 };
    }

    const requests = await db.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: employee.id,
        status: { in: BLOCKING_STATUSES },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        // Only requests created for a date in the WorkPulse accrual window are
        // charged. A legacy request that overlaps the boundary is historical.
        startDate: { gte: accrualStart, lte: accrualEnd },
        leaveType: { isPaid: true, code: { not: OT_LEAVE_CODE } },
      },
      select: { totalDays: true },
    });

    const usedDays = requests.reduce((sum, request) => sum + Number(request.totalDays || 0), 0);
    return {
      monthlyAllowance: monthlyPaidLeaveDays,
      carryForward,
      accruedDays,
      usedDays,
      remainingDays: Math.max(0, accruedDays - usedDays),
      accrualStart,
    };
  }

  async assertMonthlyPaidLeaveAvailable({ db = prisma, employee, organizationId, eligibility, leaveDate, requestedDays, excludeRequestId = null }) {
    const status = await this.getMonthlyPaidLeaveStatus({
      db,
      employee,
      organizationId,
      eligibleFrom: eligibility.eligibleFrom,
      leaveDate,
      excludeRequestId,
      eligibilityActive: eligibility.leaveEligibilityActive,
    });
    if (status.remainingDays < requestedDays) {
      const error = new Error(
        `Monthly paid leave limit exceeded. Available: ${status.remainingDays} day(s); requested: ${requestedDays} day(s). Unused monthly paid leave carries forward.`
      );
      error.statusCode = 400;
      throw error;
    }
    return status;
  }

  async getEligibilityForEmployee(employee, organizationId) {
    const policy = await policyService.getPolicy(organizationId);
    const joinedAt = employee.dateOfJoining || employee.createdAt;
    const eligibleFrom = new Date(joinedAt || new Date());
    eligibleFrom.setMonth(eligibleFrom.getMonth() + Number(policy.probationMonths || 0));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    eligibleFrom.setHours(0, 0, 0, 0);
    const leaveEligibilityActive = policy.leaveEligibilityActive ?? policy.permissionRequiresProbation;
    const eligible = !leaveEligibilityActive || today >= eligibleFrom;
    const remainingDays = eligible ? 0 : Math.max(0, Math.ceil((eligibleFrom - today) / 86400000));
    return {
      eligible,
      joinedAt,
      eligibleFrom,
      remainingDays,
      probationMonths: Number(policy.probationMonths || 0),
      monthlyPermissionHours: Number(policy.monthlyPermissionHours || 0),
      permissionRequiresProbation: Boolean(policy.permissionRequiresProbation),
      leaveEligibilityActive: Boolean(leaveEligibilityActive),
    };
  }

  async getEligibility(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return null;
    return this.getEligibilityForEmployee(employee, organizationId);
  }

  /**
   * 1. Create Leave Type (Company Admin)
   */
  async createLeaveType(organizationId, data) {
    const { name, code, daysAllowed = 12, isPaid = true } = data;

    if (typeof name !== "string" || typeof code !== "string" || !name.trim() || !code.trim()) {
      const error = new Error("Name and code are required for leave type");
      error.statusCode = 400;
      throw error;
    }

    const cleanName = name.trim();
    const cleanCode = code.trim().toUpperCase();

    const existing = await prisma.leaveType.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: cleanCode,
        },
      },
    });

    if (existing) {
      if (existing.isActive === false) {
        return await prisma.leaveType.update({
          where: { id: existing.id },
          data: {
            name: cleanName,
            daysAllowed: parseInt(daysAllowed) || 12,
            isPaid: Boolean(isPaid),
            isActive: true,
          },
        });
      }
      const error = new Error(`Leave type with code '${cleanCode}' already exists`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.leaveType.create({
      data: {
        organizationId,
        name: cleanName,
        code: cleanCode,
        daysAllowed: parseInt(daysAllowed) || 12,
        isPaid: Boolean(isPaid),
      },
    });
  }

  /**
   * 2. Get Leave Types
   */
  async getLeaveTypes(organizationId) {
    let types = await prisma.leaveType.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });

    // Seed defaults if none exist
    if (types.length === 0) {
      const defaults = [
        { name: "Casual Leave", code: "CL", daysAllowed: 12, isPaid: true },
        { name: "Sick Leave", code: "SL", daysAllowed: 10, isPaid: true },
        { name: "Earned / Annual Leave", code: "AL", daysAllowed: 15, isPaid: true },
        { name: "Unpaid Leave (LWP)", code: "LWP", daysAllowed: 30, isPaid: false },
      ];

      // Upsert instead of create: concurrent first-page loads must be safe.
      await Promise.all(defaults.map((d) => prisma.leaveType.upsert({
        where: { organizationId_code: { organizationId, code: d.code } },
        update: {},
        create: { ...d, organizationId },
      })));

      types = await prisma.leaveType.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
      });
    }

    return types.filter((type) => type.isActive !== false);
  }

  /**
   * 3. Get Employee Leave Balances for the year
   */
  async getLeaveBalances(userId, organizationId, year = new Date().getFullYear()) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    const result = await this.getEmployeeLeaveBalances(organizationId, employee.id, year);
    return result?.balances || [];
  }

  async getEmployeeLeaveBalances(organizationId, employeeId, year = new Date().getFullYear()) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      include: { department: { select: { id: true, name: true } } },
    });
    if (!employee) return null;

    const leaveTypes = await this.getLeaveTypes(organizationId);
    const eligibility = await this.getEligibilityForEmployee(employee, organizationId);
    const monthlyPaidLeave = await this.getMonthlyPaidLeaveStatus({
      employee,
      organizationId,
      eligibleFrom: eligibility.eligibleFrom,
      leaveDate: new Date(),
      eligibilityActive: eligibility.leaveEligibilityActive,
    });

    const balances = await Promise.all(
      leaveTypes.map(async (type) => {
        let balance = await prisma.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: employee.id,
              leaveTypeId: type.id,
              year: parseInt(year),
            },
          },
        });

        if (!balance) {
          balance = await prisma.leaveBalance.upsert({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId: employee.id,
                leaveTypeId: type.id,
                year: parseInt(year),
              },
            },
            update: {},
            create: {
              organizationId,
              employeeId: employee.id,
              leaveTypeId: type.id,
              year: parseInt(year),
              allocatedDays: type.daysAllowed,
              usedDays: 0,
            },
          });
        }

        const pending = await prisma.leaveRequest.aggregate({
          where: {
            organizationId,
            employeeId: employee.id,
            leaveTypeId: type.id,
            status: "PENDING",
            startDate: { gte: new Date(Date.UTC(parseInt(year), 0, 1)) },
            endDate: { lte: new Date(Date.UTC(parseInt(year), 11, 31, 23, 59, 59)) },
          },
          _sum: { totalDays: true },
        });
        const allocated = Number(balance.allocatedDays);
        const used = Number(balance.usedDays);
        const pendingDays = Number(pending._sum.totalDays || 0);
        const remaining = Math.max(0, allocated - used - pendingDays);

        return {
          id: balance.id,
          leaveType: type,
          year: balance.year,
          allocatedDays: allocated,
          usedDays: used,
          pendingDays,
          remainingDays: remaining,
          monthlyPaidLeave: type.isPaid ? monthlyPaidLeave : null,
        };
      })
    );

    return { employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName, employeeCode: employee.employeeCode, department: employee.department }, year: parseInt(year), balances };
  }

  async getDepartmentConflicts(organizationId, employeeId, startDate, endDate) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId, deletedAt: null },
      select: { id: true, departmentId: true, department: { select: { id: true, name: true } } },
    });
    if (!employee) return null;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return { department: employee.department, conflicts: [] };
    const requests = employee.departmentId
      ? await prisma.leaveRequest.findMany({
          where: {
            organizationId,
            employee: { departmentId: employee.departmentId },
            employeeId: { not: employee.id },
            status: { in: ["PENDING", "APPROVED"] },
            startDate: { lte: end },
            endDate: { gte: start },
          },
          include: { leaveType: { select: { name: true, isPaid: true } }, employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
          orderBy: { startDate: "asc" },
        })
      : [];
    return {
      department: employee.department,
      approvedCount: requests.filter((request) => request.status === "APPROVED").length,
      pendingCount: requests.filter((request) => request.status === "PENDING").length,
      conflicts: requests.map((request) => ({ id: request.id, status: request.status, startDate: request.startDate, endDate: request.endDate, totalDays: Number(request.totalDays), leaveType: request.leaveType, employee: request.employee })),
    };
  }

  async requestLeaveDateChange(userId, organizationId, requestId, data, actorRole = "EMPLOYEE") {
    const reason = String(data.reason || "").trim().slice(0, 500);
    if (!reason) throw Object.assign(new Error("A reason is required to move approved leave"), { statusCode: 400 });
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { leaveType: true, employee: { include: { user: true, department: true, shift: true } } },
    });
    if (!request) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    const isAdmin = ADMIN_ROLES.includes(actorRole);
    if (!isAdmin && request.employee?.userId !== userId) throw Object.assign(new Error("You can only change your own leave"), { statusCode: 403 });
    if (request.status !== "APPROVED") throw Object.assign(new Error("Only approved leave can be moved through a date-change request"), { statusCode: 400 });

    const newStart = await getOrgDateOnly(organizationId, new Date(data.newStartDate));
    const newEnd = await getOrgDateOnly(organizationId, new Date(data.newEndDate));
    const today = await getOrgDateOnly(organizationId, new Date());
    if (!(newStart instanceof Date) || Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime()) || newEnd < newStart) {
      throw Object.assign(new Error("Choose a valid new leave date range"), { statusCode: 400 });
    }
    if (newStart <= today) throw Object.assign(new Error("Approved leave can only be changed at least one day before the new start date"), { statusCode: 400 });

    const holidays = await prisma.holiday.findMany({
      where: { organizationId, date: { gte: newStart, lte: newEnd }, OR: [{ branchId: null }, ...(request.employee.branchId ? [{ branchId: request.employee.branchId }] : [])], isOptional: false },
    });
    const holidayKeys = new Set(holidays.map((holiday) => toDateKey(holiday.date)));
    const workingDays = classifyRangeDays(newStart, newEnd, holidayKeys, parseWorkingDays(request.employee.shift)).leaveDays.length;
    const requestedDays = request.halfDayPeriod ? 0.5 : workingDays;
    if (requestedDays !== Number(request.totalDays)) throw Object.assign(new Error("Date changes must keep the same number of leave days"), { statusCode: 400 });

    const overlap = await prisma.leaveRequest.findFirst({ where: { organizationId, employeeId: request.employeeId, id: { not: request.id }, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: newEnd }, endDate: { gte: newStart } } });
    if (overlap) throw Object.assign(new Error("The new dates overlap another leave request"), { statusCode: 409 });
    const existing = await prisma.leaveChangeRequest.findFirst({ where: { organizationId, leaveRequestId: request.id, status: "PENDING" } });
    if (existing) throw Object.assign(new Error("A date-change request is already pending"), { statusCode: 409 });

    const created = await prisma.leaveChangeRequest.create({
      data: { organizationId, leaveRequestId: request.id, employeeId: request.employeeId, oldStartDate: request.startDate, oldEndDate: request.endDate, newStartDate: newStart, newEndDate: newEnd, reason, requestedBy: userId },
      include: { leaveRequest: { include: { leaveType: true } }, employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } } },
    });
    void notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: request.employeeId,
      title: "Leave date-change request",
      summary: `requested to move ${request.leaveType?.name || "leave"} from ${toDateKey(request.startDate)}–${toDateKey(request.endDate)} to ${toDateKey(newStart)}–${toDateKey(newEnd)}.`,
    });
    return created;
  }

  async getMyLeaveChangeRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId }, select: { id: true } });
    if (!employee) return [];
    return prisma.leaveChangeRequest.findMany({ where: { organizationId, employeeId: employee.id }, include: { leaveRequest: { include: { leaveType: true } } }, orderBy: { createdAt: "desc" } });
  }

  async getAllLeaveChangeRequests(organizationId, status = "PENDING") {
    return prisma.leaveChangeRequest.findMany({ where: { organizationId, ...(status !== "ALL" ? { status } : {}) }, include: { leaveRequest: { include: { leaveType: true } }, employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } } }, orderBy: { createdAt: "desc" } });
  }

  async reviewLeaveDateChange(requestId, organizationId, reviewerUserId, data, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(data.status)) throw Object.assign(new Error("Status must be APPROVED or REJECTED"), { statusCode: 400 });
    const reviewNote = typeof data.reviewNote === "string" ? data.reviewNote.trim().slice(0, 500) : "";
    if (data.status === "REJECTED" && !reviewNote) throw Object.assign(new Error("A rejection reason is required"), { statusCode: 400 });
    const change = await prisma.leaveChangeRequest.findFirst({ where: { id: requestId, organizationId }, include: { leaveRequest: true } });
    if (!change) throw Object.assign(new Error("Date-change request not found"), { statusCode: 404 });
    if (change.status !== "PENDING") throw Object.assign(new Error("Date-change request has already been reviewed"), { statusCode: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.leaveChangeRequest.updateMany({ where: { id: requestId, organizationId, status: "PENDING" }, data: { status: data.status, reviewedBy: reviewerUserId, reviewNote: reviewNote || null, reviewedAt: new Date() } });
      if (!claimed.count) throw Object.assign(new Error("Date-change request has already been reviewed"), { statusCode: 409 });
      if (data.status === "APPROVED") {
        const oldStart = new Date(change.leaveRequest.startDate);
        const oldEnd = new Date(change.leaveRequest.endDate);
        for (let cursor = new Date(oldStart); cursor <= oldEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const date = getTodayDateOnly(cursor);
          const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: change.employeeId, date } }, select: { id: true, checkIn: true } });
          if (existing?.id && !existing.checkIn) await tx.attendance.delete({ where: { id: existing.id } });
        }
        const newStart = new Date(change.newStartDate);
        const newEnd = new Date(change.newEndDate);
        for (let cursor = new Date(newStart); cursor <= newEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const date = getTodayDateOnly(cursor);
          await tx.attendance.upsert({ where: { employeeId_date: { employeeId: change.employeeId, date } }, update: { status: "ON_LEAVE" }, create: { organizationId, employeeId: change.employeeId, date, status: "ON_LEAVE", workingMinutes: 0 } });
        }
        await tx.leaveRequest.update({ where: { id: change.leaveRequestId }, data: { startDate: change.newStartDate, endDate: change.newEndDate } });
      }
      return tx.leaveChangeRequest.findFirst({ where: { id: requestId, organizationId }, include: { leaveRequest: { include: { leaveType: true } } } });
    });
    const employee = await prisma.employee.findUnique({ where: { id: change.employeeId }, include: { user: { select: { id: true } } } });
    if (employee?.user?.id) {
      void notificationService.createNotification({
        organizationId,
        userId: employee.user.id,
        title: data.status === "APPROVED" ? "Leave dates updated" : "Leave date-change rejected",
        message: data.status === "APPROVED"
          ? `Your leave was moved to ${toDateKey(change.newStartDate)}–${toDateKey(change.newEndDate)}.`
          : `Your leave date-change request was rejected${reviewNote ? `: ${reviewNote}` : "."}`,
        type: "LEAVE",
      });
    }
    return result;
  }

  /**
   * 4. Submit Leave Request (Employee)
   */
  async createLeaveRequest(userId, organizationId, data, actorRole = "EMPLOYEE") {
    const { leaveTypeId, startDate, endDate, totalDays, halfDayPeriod, reason } = data;

    if (!leaveTypeId || !startDate || !endDate || !reason) {
      const error = new Error("leaveTypeId, startDate, endDate, and reason are required");
      error.statusCode = 400;
      throw error;
    }

    // Only privileged roles may file leave on somebody else's behalf; otherwise an
    // employee could submit requests in a colleague's name.
    const canActForOthers = ADMIN_ROLES.includes(actorRole);
    const employeeWhere =
      data.employeeId && canActForOthers
        ? { id: data.employeeId, organizationId }
        : { userId, organizationId };

    const employee = await prisma.employee.findFirst({ where: employeeWhere });

    if (!employee) {
      const error = new Error("Active employee profile not found for this account. Please verify staff directory.");
      error.statusCode = 404;
      throw error;
    }

    const eligibility = await this.getEligibilityForEmployee(employee, organizationId);

    const start = await getOrgDateOnly(organizationId, new Date(startDate));
    const end = await getOrgDateOnly(organizationId, new Date(endDate));

    if (end < start) {
      const error = new Error("End date cannot be before start date");
      error.statusCode = 400;
      throw error;
    }

    const requestedTotalDays = totalDays === undefined || totalDays === null ? null : Number(totalDays);
    const isHalfDay = requestedTotalDays === 0.5 || Boolean(halfDayPeriod);
    if (isHalfDay && !["MORNING", "AFTERNOON"].includes(halfDayPeriod)) {
      const error = new Error("Choose whether the half-day leave is for the morning or afternoon.");
      error.statusCode = 400;
      throw error;
    }
    if (isHalfDay && toDateKey(start) !== toDateKey(end)) {
      const error = new Error("Half-day leave must be for one date only.");
      error.statusCode = 400;
      throw error;
    }

    // An employee cannot be on two leaves at once, and stacking overlapping
    // requests was previously a way to drain more balance than they hold.
    const overlapping = await prisma.leaveRequest.findFirst({
      where: {
        organizationId,
        employeeId: employee.id,
        status: { in: BLOCKING_STATUSES },
        startDate: { lte: end },
        endDate: { gte: start },
      },
      include: { leaveType: { select: { name: true } } },
    });

    if (overlapping) {
      const error = new Error(
        `You already have a ${overlapping.status.toLowerCase()} ${
          overlapping.leaveType?.name || "leave"
        } request from ${toDateKey(overlapping.startDate)} to ${toDateKey(
          overlapping.endDate
        )} that overlaps these dates.`
      );
      error.statusCode = 409;
      throw error;
    }

    // Exclude official holidays for employee's branch from deductible leave days
    const holidaysInRange = await prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: start, lte: end },
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
        isOptional: false,
      },
    });

    const holidayDatesSet = new Set(holidaysInRange.map((h) => toDateKey(h.date)));

    const shift = employee.shiftId
      ? await prisma.shift.findUnique({ where: { id: employee.shiftId } })
      : null;
    const workingDaySet = parseWorkingDays(shift);

    const { leaveDays } = classifyRangeDays(start, end, holidayDatesSet, workingDaySet);
    const effectiveWorkingDays = leaveDays.length;

    if (effectiveWorkingDays === 0) {
      const error = new Error(
        "The selected range contains no working days — it falls entirely on holidays or week-offs."
      );
      error.statusCode = 400;
      throw error;
    }

    // A caller-supplied totalDays may never exceed the computed working days.
    const requestedDays = isHalfDay ? 0.5 : (requestedTotalDays !== null ? requestedTotalDays : effectiveWorkingDays);

    if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
      const error = new Error("totalDays must be a positive number");
      error.statusCode = 400;
      throw error;
    }

    const calculatedDays = Math.min(requestedDays, effectiveWorkingDays);

    let resolvedLeaveTypeId = leaveTypeId;
    let leaveType = await prisma.leaveType.findFirst({
      where: { id: resolvedLeaveTypeId, organizationId },
    });

    if (!leaveType) {
      // Check if caller passed a leave balance id
      const balanceRec = await prisma.leaveBalance.findFirst({
        where: { id: leaveTypeId, organizationId },
      });
      if (balanceRec) {
        resolvedLeaveTypeId = balanceRec.leaveTypeId;
        leaveType = await prisma.leaveType.findFirst({
          where: { id: resolvedLeaveTypeId, organizationId },
        });
      }
    }

    if (!leaveType) {
      const error = new Error("Leave type not found");
      error.statusCode = 404;
      throw error;
    }

    // Check balance for paid leaves
    if (leaveType.isPaid) {
      const isOtLeave = isOtLeaveType(leaveType);
      const eligibleOnStartDate = !eligibility.leaveEligibilityActive || start >= new Date(eligibility.eligibleFrom);
      if (!isOtLeave && !eligibleOnStartDate) {
        const error = new Error(`Paid leave becomes available after the ${eligibility.probationMonths}-month eligibility period. ${eligibility.remainingDays} day(s) remaining.`);
        error.statusCode = 400;
        throw error;
      }
      const currentYear = start.getUTCFullYear();
      const balance = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
          },
        },
      });

      // Days already committed to other pending requests are reserved — without
      // this, several pending requests can each pass the check and collectively
      // push the balance negative once they are all approved.
      const pending = await prisma.leaveRequest.aggregate({
        where: {
          organizationId,
          employeeId: employee.id,
          leaveTypeId: leaveType.id,
          status: "PENDING",
          startDate: { gte: new Date(Date.UTC(currentYear, 0, 1)) },
          endDate: { lte: new Date(Date.UTC(currentYear, 11, 31)) },
        },
        _sum: { totalDays: true },
      });

      const pendingDays = Number(pending._sum.totalDays || 0);
      const allocated = balance ? Number(balance.allocatedDays) : leaveType.daysAllowed;
      const used = balance ? Number(balance.usedDays) : 0;
      const remaining = allocated - used - pendingDays;

      if (remaining < calculatedDays) {
        const error = new Error(
          `Insufficient leave balance for ${leaveType.name}. Available: ${remaining} day(s)` +
            (pendingDays > 0 ? ` (${pendingDays} reserved by pending requests)` : "") +
            `, requested: ${calculatedDays} day(s)`
        );
        error.statusCode = 400;
        throw error;
      }

      if (!isOtLeave) {
        await this.assertMonthlyPaidLeaveAvailable({
          employee,
          organizationId,
          eligibility,
          leaveDate: end,
          requestedDays: calculatedDays,
        });
      }
    }

    const request = await prisma.leaveRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: start,
        endDate: end,
        totalDays: calculatedDays,
        halfDayPeriod: isHalfDay ? halfDayPeriod : null,
        reason,
        status: "PENDING",
      },
      include: {
        leaveType: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
    });

    void notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: "New leave request",
      summary: `applied for ${request.leaveType?.name || "leave"} from ${toDateKey(request.startDate)} to ${toDateKey(request.endDate)} (${calculatedDays} day${Number(calculatedDays) === 1 ? "" : "s"}${request.halfDayPeriod ? `, ${request.halfDayPeriod.toLowerCase()} half` : ""}).`,
    });

    return request;
  }

  /**
   * 5. Get My Leave Requests
   */
  async getMyLeaveRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    return await prisma.leaveRequest.findMany({
      take: 500, // safety cap: a person's own history can grow for years
      where: { employeeId: employee.id, organizationId },
      include: { leaveType: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 6. Get All Leave Requests (Manager & Admin)
   */
  async getAllLeaveRequests(organizationId, query = {}, reviewerRole = "COMPANY_ADMIN") {
    const { status, employeeId, page = 1, limit = 50 } = query;
    const where = { organizationId, ...visibleToReviewer(reviewerRole) };

    if (status && status !== "ALL") {
      where.status = status;
    }
    if (employeeId) {
      where.employeeId = employeeId;
    }

    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

    const [records, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          leaveType: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    return { records, total, page: curPage, totalPages: Math.ceil(total / take) };
  }

  /**
   * 7. Review Leave Request (Approve or Reject)
   */
  async reviewLeaveRequest(requestId, organizationId, reviewerUserId, { status, reviewNote }, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Status must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const normalizedReviewNote = typeof reviewNote === "string" ? reviewNote.trim().slice(0, 500) : "";
    if (status === "REJECTED" && !normalizedReviewNote) {
      const error = new Error("A rejection reason is required so the employee can understand what to correct.");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: {
        leaveType: true,
        employee: {
          include: {
            user: { select: { email: true, role: true } },
          },
        },
      },
    });

    if (!request) {
      const error = new Error("Leave request not found");
      error.statusCode = 404;
      throw error;
    }

    if (request.status !== "PENDING") {
      const error = new Error(`Leave request has already been ${request.status.toLowerCase()}`);
      error.statusCode = 400;
      throw error;
    }

    assertCanReview(request.employee?.user?.role, reviewerRole);

    // Approving your own request defeats the point of an approval workflow.
    if (request.employee?.userId && request.employee.userId === reviewerUserId) {
      const error = new Error(
        "You cannot review your own leave request. Ask another approver to action it."
      );
      error.statusCode = 403;
      throw error;
    }

    if (status === "APPROVED" && request.leaveType.isPaid && !isOtLeaveType(request.leaveType)) {
      const eligibility = await this.getEligibilityForEmployee(request.employee, organizationId);
      const eligibleOnStartDate = !eligibility.leaveEligibilityActive || request.startDate >= new Date(eligibility.eligibleFrom);
      if (!eligibleOnStartDate) {
        const error = new Error("This paid leave date is outside the employee's eligibility period.");
        error.statusCode = 400;
        throw error;
      }
      await this.assertMonthlyPaidLeaveAvailable({
        employee: request.employee,
        organizationId,
        eligibility,
        leaveDate: request.endDate,
        requestedDays: Number(request.totalDays),
        excludeRequestId: request.id,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.leaveRequest.updateMany({
        where: { id: requestId, organizationId, status: "PENDING" },
        data: {
          status,
          reviewedBy: reviewerUserId,
          reviewNote: normalizedReviewNote || null,
        },
      });
      if (claimed.count === 0) {
        const error = new Error("Leave request has already been reviewed");
        error.statusCode = 409;
        throw error;
      }

      if (status === "APPROVED") {
        // Update LeaveBalance if paid leave
        if (request.leaveType.isPaid) {
          const year = request.startDate.getUTCFullYear();
          await tx.leaveBalance.upsert({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId: request.employeeId,
                leaveTypeId: request.leaveTypeId,
                year,
              },
            },
            update: {
              usedDays: { increment: Number(request.totalDays) },
            },
            create: {
              organizationId,
              employeeId: request.employeeId,
              leaveTypeId: request.leaveTypeId,
              year,
              allocatedDays: request.leaveType.daysAllowed,
              usedDays: Number(request.totalDays),
            },
          });
        }

        // Mark attendance using exactly the same day classification the request
        // was costed with, so the balance deducted matches the days blocked out.
        const holidaysInRange = await tx.holiday.findMany({
          where: {
            organizationId,
            date: { gte: request.startDate, lte: request.endDate },
            OR: [{ branchId: null }, ...(request.employee.branchId ? [{ branchId: request.employee.branchId }] : [])],
            isOptional: false,
          },
        });
        const holidayDatesSet = new Set(holidaysInRange.map((h) => toDateKey(h.date)));

        const shift = request.employee.shiftId
          ? await tx.shift.findUnique({ where: { id: request.employee.shiftId } })
          : null;
        const workingDaySet = parseWorkingDays(shift);

        const { leaveDays } = classifyRangeDays(
          new Date(request.startDate),
          new Date(request.endDate),
          holidayDatesSet,
          workingDaySet
        );

        for (const day of request.halfDayPeriod ? [] : leaveDays) {
          const dateOnly = getTodayDateOnly(day);
          const assignedStatus = "ON_LEAVE";

          // Never overwrite a day the employee actually worked — that would erase
          // a real punch record. Those days stay as-is and are reported back.
          const existing = await tx.attendance.findUnique({
            where: {
              employeeId_date: { employeeId: request.employeeId, date: dateOnly },
            },
            select: { id: true, checkIn: true, status: true },
          });

          if (existing && (existing.checkIn || existing.status === "PRESENT")) {
            continue;
          }

          await tx.attendance.upsert({
            where: {
              employeeId_date: {
                employeeId: request.employeeId,
                date: dateOnly,
              },
            },
            update: {
              status: assignedStatus,
            },
            create: {
              organizationId,
              employeeId: request.employeeId,
              branchId: request.employee.branchId || null,
              shiftId: request.employee.shiftId || null,
              date: dateOnly,
              status: assignedStatus,
              workingMinutes: 0,
            },
          });
        }
      }

      const updated = await tx.leaveRequest.findFirst({
        where: { id: requestId, organizationId },
        include: {
          leaveType: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              organization: { select: { name: true, logoUrl: true } },
            },
          },
        },
      });

      return updated;
    });

    // Notifications are dispatched after the transaction commits and are never
    // awaited — a mail provider outage must not fail an approval that is already
    // persisted.
    const empUser = request.employee?.user;
    const empEmail = empUser?.email;
    const empPhone = request.employee?.phone;
    const empName = `${request.employee?.firstName} ${request.employee?.lastName || ""}`.trim();

    if (request.employee?.userId) {
      notificationService
        .createNotification({
          organizationId,
          userId: request.employee.userId,
          title: `Leave ${status.toLowerCase()}`,
          message:
            `Your ${request.leaveType?.name || "leave"} request for ` +
            `${toDateKey(request.startDate)} to ${toDateKey(request.endDate)} was ${status.toLowerCase()}.` +
            (normalizedReviewNote ? ` Note: ${normalizedReviewNote}` : ""),
          type: "LEAVE",
        })
        .catch((err) => console.warn("[LeaveNotification:InApp] Error:", err.message));
    }

    if (empEmail) {
      emailService
        .sendLeaveStatusEmail(empEmail, empName, {
          status,
          leaveType: request.leaveType?.name,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: Number(request.totalDays),
          reviewNote: normalizedReviewNote || null,
          companyName: request.employee?.organization?.name,
          companyLogoUrl: request.employee?.organization?.logoUrl,
        })
        .catch((err) => console.warn("[LeaveNotification:Email] Error:", err.message));
    }

    if (empPhone) {
      whatsappService
        .sendLeaveStatusWhatsApp(empPhone, empName, {
          status,
          leaveType: request.leaveType?.name,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: Number(request.totalDays),
          reviewNote: normalizedReviewNote || null,
        })
        .catch((err) => console.warn("[LeaveNotification:WhatsApp] Error:", err.message));
    }

    webhookService.dispatch(organizationId, "leave.updated", {
      leaveRequestId: requestId,
      employeeId: request.employeeId,
      status,
      startDate: request.startDate,
      endDate: request.endDate,
      totalDays: Number(request.totalDays),
    }).catch((err) => console.warn("[LeaveNotification:Webhook] Error:", err.message));

    return result;
  }

  /**
   * 7b. Cancel / withdraw a leave request.
   *
   * A PENDING request is simply withdrawn. An APPROVED future-dated request is
   * also reversible: the balance is credited back and the ON_LEAVE attendance
   * rows this request created are removed. Leave that has already started can
   * only be cancelled by an admin.
   */
  async cancelLeaveRequest(requestId, organizationId, actorUserId, actorRole = "EMPLOYEE") {
    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { leaveType: true, employee: true },
    });

    if (!request) {
      const error = new Error("Leave request not found");
      error.statusCode = 404;
      throw error;
    }

    const isOwner = request.employee?.userId === actorUserId;
    const isAdmin = ADMIN_ROLES.includes(actorRole);

    if (!isOwner && !isAdmin) {
      const error = new Error("You can only cancel your own leave requests");
      error.statusCode = 403;
      throw error;
    }

    if (!BLOCKING_STATUSES.includes(request.status)) {
      const error = new Error(`Cannot cancel a request that is already ${request.status.toLowerCase()}`);
      error.statusCode = 400;
      throw error;
    }

    const today = await getOrgDateOnly(organizationId, new Date());
    if (request.status === "APPROVED" && new Date(request.startDate) <= today && !isAdmin) {
      const error = new Error(
        "This leave has already started. Ask an administrator to cancel it for you."
      );
      error.statusCode = 400;
      throw error;
    }

    return await prisma.$transaction(async (tx) => {
      if (request.status === "APPROVED") {
        if (request.leaveType.isPaid) {
          const year = new Date(request.startDate).getUTCFullYear();
          await tx.leaveBalance.updateMany({
            where: {
              employeeId: request.employeeId,
              leaveTypeId: request.leaveTypeId,
              year,
            },
            data: { usedDays: { decrement: Number(request.totalDays) } },
          });
        }

        // Only clear the synthetic ON_LEAVE rows; days with a real punch were
        // never overwritten on approval and must stay untouched.
        await tx.attendance.deleteMany({
          where: {
            employeeId: request.employeeId,
            organizationId,
            status: "ON_LEAVE",
            checkIn: null,
            date: { gte: request.startDate, lte: request.endDate },
          },
        });
      }

      return await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status: "REJECTED",
          reviewedBy: actorUserId,
          reviewNote: isOwner ? "Withdrawn by employee" : "Cancelled by administrator",
        },
        include: { leaveType: true },
      });
    });
  }

  async updateLeaveType(organizationId, id, data) {
    const existing = await prisma.leaveType.findFirst({ where: { id, organizationId } });
    if (!existing) {
      const error = new Error("Leave type not found");
      error.statusCode = 404;
      throw error;
    }
    return prisma.leaveType.update({
      where: { id },
      data: {
        ...(data.name ? { name: String(data.name).trim() } : {}),
        ...(data.code ? { code: String(data.code).trim().toUpperCase() } : {}),
        ...(data.daysAllowed !== undefined ? { daysAllowed: parseInt(data.daysAllowed) || existing.daysAllowed } : {}),
        ...(data.isPaid !== undefined ? { isPaid: Boolean(data.isPaid) } : {}),
      },
    });
  }

  async deleteLeaveType(organizationId, id) {
    const used = await prisma.leaveRequest.count({ where: { leaveTypeId: id, organizationId } });
    if (used > 0) {
      const archived = await prisma.leaveType.updateMany({
        where: { id, organizationId },
        data: { isActive: false },
      });
      if (!archived.count) {
        const error = new Error("Leave type not found");
        error.statusCode = 404;
        throw error;
      }
      return {
        success: true,
        archived: true,
        message: "Leave type archived. Existing requests and history were preserved.",
      };
    }
    await prisma.leaveBalance.deleteMany({ where: { leaveTypeId: id } });
    await prisma.leaveType.deleteMany({ where: { id, organizationId } });
    return { success: true };
  }

  async carryForward(organizationId, { fromYear, toYear, maxDays = 15 }) {
    const src = parseInt(fromYear) || new Date().getFullYear() - 1;
    const dest = parseInt(toYear) || new Date().getFullYear();
    const cap = Math.min(366, Math.max(0, Number(maxDays) || 15));
    if (src >= dest) {
      const error = new Error("The source year must be before the destination year");
      error.statusCode = 400;
      throw error;
    }
    const types = await prisma.leaveType.findMany({ where: { organizationId, isPaid: true, isActive: true } });
    const employees = await prisma.employee.findMany({
      where: { organizationId, status: { in: WORKING_STATUSES } },
      select: { id: true },
    });
    let updated = 0;
    for (const emp of employees) {
      for (const type of types) {
        const prev = await prisma.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year: src } },
        });
        const unused = prev ? Math.max(0, Number(prev.allocatedDays) - Number(prev.usedDays)) : 0;
        const carry = Math.min(unused, cap);
        await prisma.leaveBalance.upsert({
          where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year: dest } },
          update: { allocatedDays: Number(type.daysAllowed) + carry },
          create: {
            organizationId,
            employeeId: emp.id,
            leaveTypeId: type.id,
            year: dest,
            allocatedDays: Number(type.daysAllowed) + carry,
            usedDays: 0,
          },
        });
        updated += 1;
      }
    }
    return { fromYear: src, toYear: dest, maxDays: cap, balancesUpdated: updated };
  }

  /**
   * 8. Holidays Management (Delegates to holidayService)
   */
  async createHoliday(organizationId, data) {
    return await holidayService.createHoliday(organizationId, data);
  }

  async getHolidays(organizationId, query = {}) {
    return await holidayService.getHolidays(organizationId, query);
  }
}

module.exports = new LeaveService();
