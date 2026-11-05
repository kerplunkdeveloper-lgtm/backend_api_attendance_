const prisma = require("../config/database");
const policyService = require("./policy.service");
const { getPayrollPeriod } = require("../utils/payrollCycle");

const REVIEWERS = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];
const MINUTES_PER_LEAVE_DAY = 8 * 60;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const int = (value) => Math.max(0, Math.round(Number(value) || 0));

class OvertimeAllocationService {
  async employee(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId, deletedAt: null }, select: { id: true, firstName: true, lastName: true, employeeCode: true } });
    if (!employee) throw fail("Employee profile not found", 404);
    return employee;
  }

  async period(organizationId, month, year) {
    const policy = await policyService.getPolicy(organizationId);
    return getPayrollPeriod(Number(month), Number(year), policy.payrollCycleStartDay, policy.payrollCycleEndDay);
  }

  async approvedMinutes(organizationId, employeeId, month, year) {
    const period = await this.period(organizationId, month, year);
    const requests = await prisma.overtimeRequest.findMany({
      where: { organizationId, employeeId, status: "APPROVED", attendance: { date: { gte: period.start, lte: period.end } } },
      select: { attendanceId: true, approvedMinutes: true, requestedMinutes: true, attendance: { select: { wfhNote: true } } },
    });
    const requestAttendanceIds = [...new Set(requests.map((row) => row.attendanceId))];
    const unrequestedAttendance = await prisma.attendance.aggregate({
      where: { organizationId, employeeId, date: { gte: period.start, lte: period.end }, wfhNote: { not: { startsWith: "SHOOT:" } }, ...(requestAttendanceIds.length ? { id: { notIn: requestAttendanceIds } } : {}) },
      _sum: { overtimeMinutes: true },
    });
    const regularMinutes = requests.reduce((sum, row) => row.attendance?.wfhNote?.startsWith("SHOOT:") ? sum : sum + Number(row.approvedMinutes ?? row.requestedMinutes ?? 0), 0) + Number(unrequestedAttendance._sum.overtimeMinutes || 0);
    const settlements = await prisma.shootSettlement.findMany({
      where: { organizationId, employeeId, status: "APPROVED", payrollStatus: { in: ["READY", "PROCESSED"] }, shootDate: { gte: period.start, lte: period.end } },
      select: { approvedShootOtMinutes: true, approvedTravelOtMinutes: true },
    });
    return { period, approvedMinutes: regularMinutes + settlements.reduce((sum, row) => sum + Number(row.approvedShootOtMinutes || 0) + Number(row.approvedTravelOtMinutes || 0), 0) };
  }

  async mine(userId, organizationId, month, year) {
    const employee = await this.employee(userId, organizationId);
    const totals = await this.approvedMinutes(organizationId, employee.id, month, year);
    const allocation = await prisma.overtimeAllocation.findUnique({ where: { employeeId_month_year: { employeeId: employee.id, month: Number(month), year: Number(year) } } });
    return { month: Number(month), year: Number(year), employee, approvedMinutes: totals.approvedMinutes, period: totals.period, allocation };
  }

  async submit(userId, organizationId, body = {}) {
    const employee = await this.employee(userId, organizationId);
    const month = Number(body.month); const year = Number(body.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) throw fail("Choose a valid payroll month and year.");
    const totals = await this.approvedMinutes(organizationId, employee.id, month, year);
    const locked = await prisma.payslip.findFirst({ where: { organizationId, employeeId: employee.id, month, year }, select: { id: true, status: true } });
    if (locked) throw fail("Payroll for this month has already been generated and cannot be changed.", 409);
    const existing = await prisma.overtimeAllocation.findUnique({ where: { employeeId_month_year: { employeeId: employee.id, month, year } } });
    if (existing?.status === "APPROVED") throw fail("This overtime choice is already approved. It cannot be changed after HR approval.", 409);
    const permissionMinutes = int(body.permissionMinutes);
    const leaveMinutes = int(body.leaveMinutes);
    const compOffMinutes = int(body.compOffMinutes);
    if (permissionMinutes + leaveMinutes + compOffMinutes > totals.approvedMinutes) throw fail(`Your allocation cannot exceed ${totals.approvedMinutes} approved overtime minutes.`);
    if (leaveMinutes % 240 !== 0 || compOffMinutes % 240 !== 0) throw fail("Leave and comp-off must be selected in half-day (4 hour) steps.");
    const data = { organizationId, employeeId: employee.id, month, year, approvedMinutes: totals.approvedMinutes, permissionMinutes, leaveMinutes, compOffMinutes, cashMinutes: totals.approvedMinutes - permissionMinutes - leaveMinutes - compOffMinutes, status: "PENDING", employeeNote: String(body.employeeNote || "").trim().slice(0, 500) || null, reviewNote: null, reviewedBy: null, reviewedAt: null, lockedAt: null };
    return prisma.overtimeAllocation.upsert({ where: { employeeId_month_year: { employeeId: employee.id, month, year } }, update: data, create: data });
  }

  async list(organizationId, role, query = {}) {
    if (!REVIEWERS.includes(role)) throw fail("Only HR or an approved reviewer can review overtime choices.", 403);
    const where = { organizationId, ...(query.month ? { month: Number(query.month) } : {}), ...(query.year ? { year: Number(query.year) } : {}), ...(query.status && query.status !== "ALL" ? { status: query.status } : {}) };
    return prisma.overtimeAllocation.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 500 });
  }

  async review(id, organizationId, reviewerUserId, role, body = {}) {
    if (!REVIEWERS.includes(role)) throw fail("Only HR or an approved reviewer can review overtime choices.", 403);
    if (!["APPROVED", "REJECTED"].includes(body.status)) throw fail("Choose approve or reject.");
    const row = await prisma.overtimeAllocation.findFirst({ where: { id, organizationId }, include: { employee: { select: { id: true, userId: true } } } });
    if (!row) throw fail("Overtime choice not found.", 404);
    if (row.status !== "PENDING") throw fail(`This overtime choice is already ${row.status.toLowerCase()}.`, 409);
    const totals = await this.approvedMinutes(organizationId, row.employeeId, row.month, row.year);
    if (totals.approvedMinutes !== row.approvedMinutes) throw fail("Approved overtime changed. Ask the employee to resubmit the monthly choice.", 409);
    const locked = await prisma.payslip.findFirst({ where: { organizationId, employeeId: row.employeeId, month: row.month, year: row.year }, select: { id: true } });
    if (locked) throw fail("Payroll has already been generated for this month.", 409);
    if (body.status === "REJECTED") return prisma.overtimeAllocation.update({ where: { id }, data: { status: "REJECTED", reviewNote: String(body.reviewNote || "").trim().slice(0, 500) || null, reviewedBy: reviewerUserId, reviewedAt: new Date() } });
    return prisma.$transaction(async (tx) => {
      if (row.compOffMinutes > 0) {
        const days = row.compOffMinutes / MINUTES_PER_LEAVE_DAY;
        const balance = await tx.compOffBalance.upsert({ where: { employeeId: row.employeeId }, update: { creditedDays: { increment: days } }, create: { organizationId, employeeId: row.employeeId, creditedDays: days, usedDays: 0 } });
        await tx.compOffTransaction.create({ data: { compOffBalanceId: balance.id, type: "CREDIT", days, reason: `OT conversion ${row.month}/${row.year}`, createdBy: reviewerUserId } });
      }
      if (row.leaveMinutes > 0) {
        const leaveType = await tx.leaveType.findFirst({ where: { organizationId, isActive: true, isPaid: true }, orderBy: { code: "asc" } });
        if (!leaveType) throw fail("Create an active paid leave type before approving leave conversion.", 422);
        await tx.leaveBalance.upsert({ where: { employeeId_leaveTypeId_year: { employeeId: row.employeeId, leaveTypeId: leaveType.id, year: row.year } }, update: { allocatedDays: { increment: row.leaveMinutes / MINUTES_PER_LEAVE_DAY } }, create: { organizationId, employeeId: row.employeeId, leaveTypeId: leaveType.id, year: row.year, allocatedDays: row.leaveMinutes / MINUTES_PER_LEAVE_DAY, usedDays: 0 } });
      }
      return tx.overtimeAllocation.update({ where: { id }, data: { status: "APPROVED", reviewNote: String(body.reviewNote || "").trim().slice(0, 500) || null, reviewedBy: reviewerUserId, reviewedAt: new Date() } });
    });
  }
}

module.exports = new OvertimeAllocationService();
