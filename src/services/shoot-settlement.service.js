const prisma = require("../config/database");
const policyService = require("./policy.service");

const REVIEWERS = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];
const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; return error; };
const clean = (value, max = 500) => String(value || "").trim().slice(0, max);
const number = (value, fallback = 0) => { const result = Number(value); return Number.isFinite(result) ? result : fallback; };
const boolean = (value) => value === true || value === 1 || String(value).toLowerCase() === "true" || String(value) === "1";
const dateOnly = (value) => { const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00.000Z`); return Number.isNaN(date.getTime()) ? null : date; };
const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  const a = new Date(start), b = new Date(end);
  return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) ? 0 : Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
};
const sumItems = (items) => Array.isArray(items) ? items.reduce((sum, item) => sum + Math.max(0, number(item?.amount)), 0) : 0;
const normalizeItems = (items, label) => {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((item) => ({ category: clean(item?.category || label, 60), amount: Math.round(Math.max(0, number(item?.amount)) * 100) / 100, note: clean(item?.note, 300) })).filter((item) => item.amount > 0);
};

class ShootSettlementService {
  async create(userId, organizationId, body = {}) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId, deletedAt: null }, select: { id: true } });
    if (!employee) throw fail("Your employee profile could not be found.", 404);
    const shootDate = dateOnly(body.shootDate);
    if (!shootDate) throw fail("Choose the shoot date.");
    const shootRequest = await prisma.shootRequest.findFirst({ where: { id: String(body.shootRequestId || ""), organizationId, status: "APPROVED", participants: { some: { employeeId: employee.id } } }, select: { id: true, date: true } });
    if (!shootRequest) throw fail("Only an approved shoot can have a settlement.", 422);
    const existing = await prisma.shootSettlement.findUnique({ where: { employeeId_shootRequestId: { employeeId: employee.id, shootRequestId: shootRequest.id } }, select: { id: true, status: true } });
    if (existing && existing.status !== "REJECTED") throw fail("This shoot settlement was already submitted.", 409);

    const travelStart = body.travelStart ? new Date(body.travelStart) : null;
    const travelEnd = body.travelEnd ? new Date(body.travelEnd) : null;
    if (!travelStart || !travelEnd || Number.isNaN(travelStart.getTime()) || Number.isNaN(travelEnd.getTime()) || travelEnd <= travelStart) throw fail("Enter a valid travel start and end time.");
    const travelMinutes = minutesBetween(travelStart, travelEnd);
    const shootStart = body.shootStart ? new Date(body.shootStart) : null;
    const shootEnd = body.shootEnd ? new Date(body.shootEnd) : null;
    if ((shootStart && Number.isNaN(shootStart.getTime())) || (shootEnd && Number.isNaN(shootEnd.getTime())) || (shootStart && shootEnd && shootEnd <= shootStart)) throw fail("Enter a valid shoot start and end time.");
    const returnedNextDay = boolean(body.returnedNextDay);
    const shootMinutesInput = Math.max(0, Math.round(number(body.shootMinutes)));
    const shootMinutesFromRange = shootStart && shootEnd ? minutesBetween(shootStart, shootEnd) : 0;
    const returnedAttendance = await prisma.attendance.findFirst({ where: { employeeId: employee.id, organizationId, date: shootDate }, select: { id: true, checkIn: true, checkOut: true, overtimeMinutes: true, workingMinutes: true } });
    if (!returnedAttendance?.checkIn || !returnedAttendance?.checkOut) throw fail("Complete your Shoot Out before submitting this settlement.", 422);
    const shootMinutes = shootMinutesFromRange || shootMinutesInput || Math.max(0, Number(returnedAttendance.workingMinutes || 0));
    if (!shootMinutes) throw fail("Add the total shoot working time.");
    const policy = await policyService.getPolicy(organizationId);
    const totalDutyMinutes = shootMinutes + travelMinutes;
    const recoveryLeaveEligible = Boolean(policy.shootRecoveryEnabled && returnedNextDay && totalDutyMinutes >= Number(policy.shootRecoveryThresholdMinutes || 720));
    const data = {
      organizationId, employeeId: employee.id, shootRequestId: shootRequest.id, attendanceId: returnedAttendance.id || null, shootDate, shootStart, shootEnd,
      travelStart, travelEnd,
      returnedNextDay, shootMinutes, travelMinutes, shootOvertimeMinutes: Math.max(0, returnedAttendance.overtimeMinutes || 0),
      travelOvertimeMinutes: policy.shootTravelOtEnabled && !returnedNextDay ? travelMinutes : 0,
      totalDutyMinutes, recoveryLeaveEligible, recoveryLeaveRequested: Boolean(body.recoveryLeaveRequested && recoveryLeaveEligible),
      recoveryLeaveStatus: null, recoveryLeaveDate: body.recoveryLeaveDate ? dateOnly(body.recoveryLeaveDate) : null,
      allowances: normalizeItems(body.allowances, "Allowance"), expenses: normalizeItems(body.expenses, "Expense"), employeeNote: clean(body.employeeNote, 1000) || null,
      status: "PENDING", payrollStatus: "NOT_READY", reviewedBy: null, reviewedAt: null, hrNote: null,
    };
    if (data.recoveryLeaveRequested && !data.recoveryLeaveDate) throw fail("Choose the recovery leave date.");
    return existing
      ? prisma.shootSettlement.update({ where: { id: existing.id }, data })
      : prisma.shootSettlement.create({ data });
  }

  async mine(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId }, select: { id: true } });
    if (!employee) return [];
    try {
      return await prisma.shootSettlement.findMany({ where: { organizationId, employeeId: employee.id }, include: { shootRequest: { select: { shootName: true, location: true, date: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    } catch (error) {
      if (error?.code === "P2021" || error?.code === "P2022") return [];
      throw error;
    }
  }

  async list(organizationId, role, query = {}) {
    if (!REVIEWERS.includes(role)) throw fail("Only HR or an approved reviewer can view shoot settlements.", 403);
    try {
      return await prisma.shootSettlement.findMany({ where: { organizationId, ...(query.status && query.status !== "ALL" ? { status: query.status } : {}) }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } }, shootRequest: { select: { shootName: true, location: true, date: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
    } catch (error) {
      if (error?.code === "P2021" || error?.code === "P2022") return [];
      throw error;
    }
  }

  async review(id, organizationId, reviewerUserId, role, body = {}) {
    if (!REVIEWERS.includes(role)) throw fail("Only HR or an approved reviewer can review settlements.", 403);
    if (!["APPROVED", "REJECTED"].includes(body.status)) throw fail("Choose approve or reject.");
    const row = await prisma.shootSettlement.findFirst({ where: { id, organizationId }, include: { employee: { include: { salaryStructure: true } } } });
    if (!row) throw fail("Shoot settlement not found.", 404);
    if (row.status !== "PENDING") throw fail(`This settlement is already ${row.status.toLowerCase()}.`, 409);
    if (body.status === "REJECTED") return prisma.shootSettlement.update({ where: { id }, data: { status: "REJECTED", hrNote: clean(body.reviewNote, 1000) || null, reviewedBy: reviewerUserId, reviewedAt: new Date(), payrollStatus: "NOT_READY" } });
    const policy = await policyService.getPolicy(organizationId);
    const submittedAllowanceAmount = Math.round(sumItems(row.allowances) * 100) / 100;
    const submittedExpenseAmount = Math.round(sumItems(row.expenses) * 100) / 100;
    const approvedShootMinutes = Math.min(Math.max(0, Math.round(number(body.approvedShootMinutes, row.shootMinutes))), Math.max(0, row.shootMinutes));
    const approvedTravelOtMinutes = policy.shootTravelOtEnabled && !row.returnedNextDay
      ? Math.min(Math.max(0, Math.round(number(body.approvedTravelOtMinutes, row.travelOvertimeMinutes))), Math.max(0, row.travelOvertimeMinutes))
      : 0;
    const approvedAllowanceAmount = Math.min(Math.max(0, Math.round(number(body.approvedAllowanceAmount, submittedAllowanceAmount) * 100) / 100), submittedAllowanceAmount);
    const approvedExpenseAmount = Math.min(Math.max(0, Math.round(number(body.approvedExpenseAmount, submittedExpenseAmount) * 100) / 100), submittedExpenseAmount);
    const salary = row.employee.salaryStructure;
    const salaryBase = policy.shootOtSalaryBasis === "MONTHLY_CTC" ? number(salary?.monthlyCtc) : number(salary?.baseSalary);
    const hourlyRate = salaryBase > 0 ? salaryBase / Number(policy.workingDaysPerMonth || 26) / 8 : 0;
    const totalOtMinutes = Math.max(0, Math.round(number(row.shootOvertimeMinutes))) + approvedTravelOtMinutes;
    const overtimePay = Math.round(hourlyRate * (totalOtMinutes / 60) * number(policy.shootOtMultiplier, 1.5) * 100) / 100;
    const approvedShootOtMinutes = Math.min(Math.max(0, Math.round(number(body.approvedShootOtMinutes, row.shootOvertimeMinutes))), Math.max(0, row.shootOvertimeMinutes));
    const finalOtPay = Math.round((hourlyRate * ((approvedShootOtMinutes + approvedTravelOtMinutes) / 60) * number(policy.shootOtMultiplier, 1.5)) * 100) / 100;
    return prisma.$transaction(async (tx) => {
      const updated = await tx.shootSettlement.update({ where: { id }, data: { status: "APPROVED", approvedShootMinutes, approvedShootOtMinutes, approvedTravelOtMinutes, approvedAllowanceAmount, approvedExpenseAmount, overtimePay: finalOtPay, recoveryLeaveStatus: row.recoveryLeaveRequested && row.recoveryLeaveEligible ? "APPROVED" : null, hrNote: clean(body.reviewNote, 1000) || null, reviewedBy: reviewerUserId, reviewedAt: new Date(), payrollStatus: "READY" } });
      if (row.recoveryLeaveRequested && row.recoveryLeaveEligible && row.recoveryLeaveDate) {
        const leaveType = await tx.leaveType.upsert({ where: { organizationId_code: { organizationId, code: "RECOVERY" } }, update: { name: "Recovery Leave", isPaid: true, isActive: true }, create: { organizationId, name: "Recovery Leave", code: "RECOVERY", daysAllowed: 365, isPaid: true, isActive: true } });
        const existingLeave = await tx.leaveRequest.findFirst({ where: { organizationId, employeeId: row.employeeId, leaveTypeId: leaveType.id, startDate: row.recoveryLeaveDate, endDate: row.recoveryLeaveDate, reason: { contains: row.id } }, select: { id: true } });
        if (!existingLeave) await tx.leaveRequest.create({ data: { organizationId, employeeId: row.employeeId, leaveTypeId: leaveType.id, startDate: row.recoveryLeaveDate, endDate: row.recoveryLeaveDate, totalDays: 1, reason: `Recovery Leave from shoot settlement ${row.id}`, status: "APPROVED", reviewedBy: reviewerUserId, reviewNote: "Approved with shoot settlement" } });
      }
      return updated;
    });
  }
}

module.exports = new ShootSettlementService();
