const prisma = require("../config/database");
const { getTodayDateOnly, getOrgDateOnly } = require("./attendance.service");
const holidayService = require("./holiday.service");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");
const notificationService = require("./notification.service");

const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"];

/** Statuses that still occupy leave balance and block an overlapping request. */
const BLOCKING_STATUSES = ["PENDING", "APPROVED"];

const toDateKey = (date) => new Date(date).toISOString().split("T")[0];

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
  /**
   * 1. Create Leave Type (Company Admin)
   */
  async createLeaveType(organizationId, data) {
    const { name, code, daysAllowed = 12, isPaid = true } = data;

    if (!name || !code) {
      const error = new Error("Name and code are required for leave type");
      error.statusCode = 400;
      throw error;
    }

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
      const error = new Error(`Leave type with code '${cleanCode}' already exists`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.leaveType.create({
      data: {
        organizationId,
        name: name.trim(),
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

      for (const d of defaults) {
        await prisma.leaveType.create({
          data: { ...d, organizationId },
        });
      }

      types = await prisma.leaveType.findMany({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
      });
    }

    return types;
  }

  /**
   * 3. Get Employee Leave Balances for the year
   */
  async getLeaveBalances(userId, organizationId, year = new Date().getFullYear()) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    const leaveTypes = await this.getLeaveTypes(organizationId);

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
          balance = await prisma.leaveBalance.create({
            data: {
              organizationId,
              employeeId: employee.id,
              leaveTypeId: type.id,
              year: parseInt(year),
              allocatedDays: type.daysAllowed,
              usedDays: 0,
            },
          });
        }

        const allocated = Number(balance.allocatedDays);
        const used = Number(balance.usedDays);
        const remaining = Math.max(0, allocated - used);

        return {
          id: balance.id,
          leaveType: type,
          year: balance.year,
          allocatedDays: allocated,
          usedDays: used,
          remainingDays: remaining,
        };
      })
    );

    return balances;
  }

  /**
   * 4. Submit Leave Request (Employee)
   */
  async createLeaveRequest(userId, organizationId, data, actorRole = "EMPLOYEE") {
    const { leaveTypeId, startDate, endDate, totalDays, reason } = data;

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

    const start = await getOrgDateOnly(organizationId, new Date(startDate));
    const end = await getOrgDateOnly(organizationId, new Date(endDate));

    if (end < start) {
      const error = new Error("End date cannot be before start date");
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
    const requestedDays =
      totalDays !== undefined && totalDays !== null ? Number(totalDays) : effectiveWorkingDays;

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
    }

    const request = await prisma.leaveRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: start,
        endDate: end,
        totalDays: calculatedDays,
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
      where: { employeeId: employee.id, organizationId },
      include: { leaveType: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * 6. Get All Leave Requests (Manager & Admin)
   */
  async getAllLeaveRequests(organizationId, query = {}) {
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

    return { records, total, page: parseInt(page), totalPages: Math.ceil(total / take) };
  }

  /**
   * 7. Review Leave Request (Approve or Reject)
   */
  async reviewLeaveRequest(requestId, organizationId, reviewerUserId, { status, reviewNote }) {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Status must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const request = await prisma.leaveRequest.findFirst({
      where: { id: requestId, organizationId },
      include: {
        leaveType: true,
        employee: {
          include: {
            user: { select: { email: true } },
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

    // Approving your own request defeats the point of an approval workflow.
    if (request.employee?.userId && request.employee.userId === reviewerUserId) {
      const error = new Error(
        "You cannot review your own leave request. Ask another approver to action it."
      );
      error.statusCode = 403;
      throw error;
    }

    const result = await prisma.$transaction(async (tx) => {
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

        for (const day of leaveDays) {
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

      const updated = await tx.leaveRequest.update({
        where: { id: requestId },
        data: {
          status,
          reviewedBy: reviewerUserId,
          reviewNote: reviewNote || null,
        },
        include: {
          leaveType: true,
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true },
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
            (reviewNote ? ` Note: ${reviewNote}` : ""),
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
          reviewNote,
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
          reviewNote,
        })
        .catch((err) => console.warn("[LeaveNotification:WhatsApp] Error:", err.message));
    }

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
      const error = new Error("Cannot delete a leave type that already has requests");
      error.statusCode = 400;
      throw error;
    }
    await prisma.leaveBalance.deleteMany({ where: { leaveTypeId: id } });
    await prisma.leaveType.deleteMany({ where: { id, organizationId } });
    return { success: true };
  }

  async carryForward(organizationId, { fromYear, toYear, maxDays = 15 }) {
    const src = parseInt(fromYear) || new Date().getFullYear() - 1;
    const dest = parseInt(toYear) || new Date().getFullYear();
    const cap = Math.max(0, Number(maxDays) || 15);
    const types = await prisma.leaveType.findMany({ where: { organizationId, isPaid: true } });
    const employees = await prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE" },
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
          update: { allocatedDays: type.daysAllowed + carry },
          create: {
            organizationId,
            employeeId: emp.id,
            leaveTypeId: type.id,
            year: dest,
            allocatedDays: type.daysAllowed + carry,
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
