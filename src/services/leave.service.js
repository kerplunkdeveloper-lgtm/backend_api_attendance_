const prisma = require("../config/database");
const { getTodayDateOnly } = require("./attendance.service");
const holidayService = require("./holiday.service");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");

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
  async createLeaveRequest(userId, organizationId, data) {
    const { leaveTypeId, startDate, endDate, totalDays, reason } = data;

    if (!leaveTypeId || !startDate || !endDate || !reason) {
      const error = new Error("leaveTypeId, startDate, endDate, and reason are required");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: data.employeeId ? { id: data.employeeId, organizationId } : { userId, organizationId },
    });

    if (!employee) {
      const error = new Error("Active employee profile not found for this account. Please verify staff directory.");
      error.statusCode = 404;
      throw error;
    }

    const start = getTodayDateOnly(new Date(startDate));
    const end = getTodayDateOnly(new Date(endDate));

    if (end < start) {
      const error = new Error("End date cannot be before start date");
      error.statusCode = 400;
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

    const holidayDatesSet = new Set(
      holidaysInRange.map((h) => new Date(h.date).toISOString().split("T")[0])
    );

    let effectiveWorkingDays = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const dayOfWeek = cur.getDay(); // 0 = Sunday
      const dateStr = cur.toISOString().split("T")[0];
      const isWeekend = dayOfWeek === 0;
      const isHoliday = holidayDatesSet.has(dateStr);

      if (!isWeekend && !isHoliday) {
        effectiveWorkingDays += 1;
      }
      cur.setDate(cur.getDate() + 1);
    }

    const calculatedDays = totalDays !== undefined ? Number(totalDays) : Math.max(1, effectiveWorkingDays);

    const leaveType = await prisma.leaveType.findFirst({
      where: { id: leaveTypeId, organizationId },
    });

    if (!leaveType) {
      const error = new Error("Leave type not found");
      error.statusCode = 404;
      throw error;
    }

    // Check balance for paid leaves
    if (leaveType.isPaid) {
      const currentYear = start.getFullYear();
      let balance = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
          },
        },
      });

      const remaining = balance
        ? Number(balance.allocatedDays) - Number(balance.usedDays)
        : leaveType.daysAllowed;

      if (remaining < calculatedDays) {
        const error = new Error(
          `Insufficient leave balance for ${leaveType.name}. Remaining: ${remaining} days, Requested: ${calculatedDays} days`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const request = await prisma.leaveRequest.create({
      data: {
        organizationId,
        employeeId: employee.id,
        leaveTypeId,
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

    return await prisma.$transaction(async (tx) => {
      if (status === "APPROVED") {
        // Update LeaveBalance if paid leave
        if (request.leaveType.isPaid) {
          const year = request.startDate.getFullYear();
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

        // Automatically create or update Attendance records for all days in the leave range
        const curDate = new Date(request.startDate);
        const endDate = new Date(request.endDate);

        const holidaysInRange = await tx.holiday.findMany({
          where: {
            organizationId,
            date: { gte: request.startDate, lte: request.endDate },
            OR: [{ branchId: null }, ...(request.employee.branchId ? [{ branchId: request.employee.branchId }] : [])],
            isOptional: false,
          },
        });
        const holidayDatesSet = new Set(
          holidaysInRange.map((h) => new Date(h.date).toISOString().split("T")[0])
        );

        while (curDate <= endDate) {
          const dateOnly = getTodayDateOnly(curDate);
          const dateStr = curDate.toISOString().split("T")[0];
          const isHoliday = holidayDatesSet.has(dateStr);
          const assignedStatus = isHoliday ? "HOLIDAY" : "ON_LEAVE";

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

          curDate.setDate(curDate.getDate() + 1);
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

    // Asynchronously dispatch Email & WhatsApp notifications
    const empUser = request.employee?.user;
    const empEmail = empUser?.email;
    const empPhone = request.employee?.phone;
    const empName = `${request.employee?.firstName} ${request.employee?.lastName || ""}`.trim();

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
