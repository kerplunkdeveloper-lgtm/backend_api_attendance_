const prisma = require("../config/database");
const { getOrgDateOnly } = require("./attendance.service");
const policyService = require("./policy.service");
const { getPayrollPeriod, resolveDayBasis, parseWorkingDays, classifyPayrollDays, computePermissionDeduction, buildCompanyLeaveMap, toIsoKey, round2 } = require("../utils/payrollCycle");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");
const money = require("../utils/money");
const statutoryService = require("./statutory.service");
const { normalizeSplit, buildSalaryBreakdown } = require("../utils/salarySplit");

/** Mask a bank account so only the last 4 digits are shown on payslips. */
const maskAccount = (value) => {
  const digits = String(value).replace(/\s+/g, "");
  if (!digits) return null;
  if (digits.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
};

/** Statuses after which a payslip's numbers are final and must not be recomputed. */
const LOCKED_PAYSLIP_STATUSES = ["APPROVED", "DISBURSED"];

/** Allowed payslip status transitions. Disbursed is terminal. */
const STATUS_TRANSITIONS = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "REJECTED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["DISBURSED", "REJECTED"],
  REJECTED: ["DRAFT", "PENDING_APPROVAL"],
  DISBURSED: [],
};

/** Normalise a Date to a YYYY-MM-DD key for set membership tests. */
const toDateKey = (date) => new Date(date).toISOString().slice(0, 10);

class PayrollService {
  /**
   * Returns the set of YYYY-MM-DD dates in the range that are covered by an
   * APPROVED leave request whose leave type is unpaid (loss of pay).
   */
  async _getUnpaidLeaveDates(organizationId, employeeId, startDate, endDate) {
    const unpaidRequests = await prisma.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId,
        status: "APPROVED",
        leaveType: { isPaid: false },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { startDate: true, endDate: true },
    });

    const dates = new Set();
    for (const req of unpaidRequests) {
      const cursor = new Date(
        Math.max(new Date(req.startDate).getTime(), startDate.getTime())
      );
      const last = new Date(Math.min(new Date(req.endDate).getTime(), endDate.getTime()));
      while (cursor <= last) {
        dates.add(toDateKey(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    return dates;
  }

  /**
   * 1. Set or update employee salary structure
   */
  async upsertSalaryStructure(organizationId, data) {
    const {
      employeeId,
      annualCtc,
      monthlyCtc,
      baseSalary,
      hra = 0,
      transport = 0,
      transportAllowance,
      special = 0,
      specialAllowance,
      otherAllowance = 0,
      pf = 0,
      esi = 0,
      professionalTax = 0,
      overtimeRate = 1.5,
    } = data;

    if (!employeeId || baseSalary === undefined) {
      const error = new Error("employeeId and baseSalary are required");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });

    if (!employee) {
      const error = new Error("Employee not found in this organization");
      error.statusCode = 404;
      throw error;
    }

    const finalTransport = transport !== undefined ? transport : (transportAllowance || 0);
    const finalSpecial = special !== undefined ? special : (specialAllowance || 0);
    const finalAnnualCtc = annualCtc !== undefined && annualCtc !== null ? Number(annualCtc) : (monthlyCtc ? Number(monthlyCtc) * 12 : null);
    const finalMonthlyCtc = monthlyCtc !== undefined && monthlyCtc !== null ? Number(monthlyCtc) : (annualCtc ? Number(annualCtc) / 12 : null);

    const updatePayload = {
      annualCtc: finalAnnualCtc,
      monthlyCtc: finalMonthlyCtc,
      baseSalary: Number(baseSalary),
      hra: Number(hra),
      transport: Number(finalTransport),
      special: Number(finalSpecial),
      otherAllowance: Number(otherAllowance),
      pf: Number(pf),
      esi: Number(esi),
      professionalTax: Number(professionalTax),
      overtimeRate: Number(overtimeRate),
    };

    return await prisma.salaryStructure.upsert({
      where: { employeeId },
      update: updatePayload,
      create: {
        organizationId,
        employeeId,
        ...updatePayload,
      },
    });
  }

  /**
   * Set or customise salary for many employees in one request. Each row keeps its own
   * annual CTC; the percentage split is shared. Failures are reported per employee and
   * do not stop the rest. Optionally sends each changed employee an in-app notification.
   */
  async bulkUpsertSalaryStructures(organizationId, data = {}) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (entries.length === 0) {
      const error = new Error("Provide at least one employee salary entry");
      error.statusCode = 400;
      throw error;
    }
    if (entries.length > 1000) {
      const error = new Error("Bulk salary update is limited to 1000 employees per request");
      error.statusCode = 400;
      throw error;
    }

    const split = normalizeSplit(data.split);
    const ids = [...new Set(entries.map((entry) => String(entry?.employeeId || "")).filter(Boolean))];
    const employees = await prisma.employee.findMany({
      where: { organizationId, deletedAt: null, id: { in: ids } },
      select: { id: true, userId: true },
    });
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

    const failed = [];
    const planned = [];
    for (const entry of entries) {
      const employeeId = String(entry?.employeeId || "");
      const employee = employeeById.get(employeeId);
      if (!employee) {
        failed.push({ employeeId, message: "Employee not found in this organization" });
        continue;
      }
      try {
        planned.push({ employee, breakdown: buildSalaryBreakdown(entry.annualCtc, split) });
      } catch (err) {
        failed.push({ employeeId, message: err.message });
      }
    }

    // Save in small parallel batches so a large run does not exhaust the connection pool.
    const saved = [];
    for (let i = 0; i < planned.length; i += 10) {
      const batch = planned.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(({ employee, breakdown }) =>
          this.upsertSalaryStructure(organizationId, { employeeId: employee.id, ...breakdown }),
        ),
      );
      results.forEach((result, index) => {
        const { employee, breakdown } = batch[index];
        if (result.status === "fulfilled") saved.push({ employee, breakdown });
        else failed.push({ employeeId: employee.id, message: result.reason?.message || "Save failed" });
      });
    }

    let notified = 0;
    if (data.notify === true) {
      const rows = saved
        .filter(({ employee }) => employee.userId)
        .map(({ employee, breakdown }) => ({
          organizationId,
          userId: employee.userId,
          type: "PAYROLL",
          title: "Salary structure updated",
          message: `Your annual CTC is now ₹${Math.round(breakdown.annualCtc).toLocaleString("en-IN")}.`,
        }));
      if (rows.length) {
        const result = await prisma.notification.createMany({ data: rows });
        notified = result.count;
      }
    }

    return { updated: saved.length, failed, notified };
  }

  /**
   * 2. Get salary structure for employee
   */
  async getSalaryStructure(organizationId, employeeId) {
    return await prisma.salaryStructure.findFirst({
      where: { organizationId, employeeId },
    });
  }

  /**
   * Payroll for one employee over the organization's payroll cycle (for example 5th to 4th,
   * or the calendar month). Loss-of-pay days, late marks, and permission hours beyond the
   * allowance are deducted at the org's day basis (actual days, fixed 30, or working days).
   */
  async calculateEmployeePayroll(organizationId, employeeId, month, year) {
    const m = parseInt(month);
    const y = parseInt(year);

    const policy = await policyService.getPolicy(organizationId);
    const period = getPayrollPeriod(m, y, policy.payrollCycleStartDay, policy.payrollCycleEndDay);
    const basisDays = resolveDayBasis(policy.payrollDayBasis, period, policy.workingDaysPerMonth);
    const maxLatesBeforeDeduction = policy.maxLatesBeforeDeduction;
    const lateDeductionPercent = policy.lateDeductionPercent;

    // Fetch employee and salary structure
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: {
        salaryStructure: true,
        shift: { select: { workingDays: true } },
        user: { select: { email: true } },
      },
    });

    if (!employee) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }

    if (!employee.salaryStructure) {
      const error = new Error(
        `No salary structure configured for ${employee.firstName} (${employee.employeeCode}). Set CTC before generating payroll.`
      );
      error.statusCode = 422;
      throw error;
    }

    const salary = employee.salaryStructure;

    const annualCtc = salary.annualCtc ? Number(salary.annualCtc) : null;
    const monthlyCtc = salary.monthlyCtc ? Number(salary.monthlyCtc) : null;
    const baseSalary = Number(salary.baseSalary);
    const hra = Number(salary.hra);
    const transport = Number(salary.transport);
    const special = Number(salary.special);
    const otherAllowance = Number(salary.otherAllowance || 0);
    const allowancesTotal = money.sum(hra, transport, special, otherAllowance);
    const pf = Number(salary.pf || 0);
    const esi = Number(salary.esi || 0);
    const professionalTax = Number(salary.professionalTax || 0);
    const overtimeMultiplier = Number(salary.overtimeRate) || 1.5;

    const dailyRate = money.divide(baseSalary, basisDays);
    const hourlyRate = money.divide(dailyRate, 8);

    const todayDate = await getOrgDateOnly(organizationId);
    const todayKey = toIsoKey(todayDate);

    // Attendance rows for the cycle, and the per-day status they record
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        organizationId,
        date: { gte: period.start, lte: period.end },
      },
    });
    const attendanceStatusByKey = new Map(attendances.map((att) => [toIsoKey(att.date), att.status]));

    // An ON_LEAVE attendance row does not say whether the leave was paid — that
    // lives on LeaveType.isPaid. Without this lookup, loss-of-pay leave would be
    // counted as paid leave and the employee would be paid in full.
    const unpaidLeaveKeys = await this._getUnpaidLeaveDates(organizationId, employeeId, period.start, period.end);

    // Company-wide holidays plus holidays for this employee's branch
    const holidays = await prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: period.start, lte: period.end },
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
      select: { date: true },
    });
    const holidayKeys = new Set(holidays.map((holiday) => toIsoKey(holiday.date)));

    // Company-wide leave that covers this cycle: all employees, or only this branch
    const companyLeaves = await prisma.companyLeave.findMany({
      where: {
        organizationId,
        startDate: { lte: period.end },
        endDate: { gte: period.start },
        OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])],
      },
      select: { startDate: true, endDate: true, isPaid: true },
    });
    const companyLeaveByKey = buildCompanyLeaveMap(companyLeaves, period);

    const dayCounts = classifyPayrollDays({
      period,
      asOf: todayDate,
      workingDays: parseWorkingDays(employee.shift?.workingDays),
      holidayKeys,
      attendanceStatusByKey,
      unpaidLeaveKeys,
      companyLeaveByKey,
      todayKey,
    });

    let totalOvertimeMinutes = 0;
    if (!policy.requireOtApproval) {
      attendances.forEach((att) => {
        totalOvertimeMinutes += att.overtimeMinutes || 0;
      });
    } else {
      const approvedOt = await prisma.overtimeRequest.findMany({
        where: {
          organizationId,
          employeeId,
          status: "APPROVED",
          attendance: { date: { gte: period.start, lte: period.end } },
        },
        select: { approvedMinutes: true, requestedMinutes: true },
      });
      totalOvertimeMinutes = approvedOt.reduce(
        (sum, row) => sum + (row.approvedMinutes ?? row.requestedMinutes ?? 0),
        0
      );
    }

    const overtimeHours = Math.round((totalOvertimeMinutes / 60) * 10) / 10;
    const overtimePay = money.multiply(
      money.multiply(hourlyRate, overtimeHours),
      overtimeMultiplier
    );

    // Permission hours approved in this cycle. The monthly allowance covers the first hours in
    // each cycle; hours beyond it are charged at the hourly rate.
    const approvedPermissions = await prisma.permissionRequest.findMany({
      where: {
        organizationId,
        employeeId,
        status: "APPROVED",
        date: { gte: period.start, lte: period.end },
      },
      select: { hours: true },
    });
    const approvedPermissionHours = approvedPermissions.reduce((sum, row) => sum + Number(row.hours), 0);
    const permission = computePermissionDeduction({
      approvedHours: approvedPermissionHours,
      allowanceHours: policy.monthlyPermissionHours,
      dailyRate,
    });

    const unpaidLeaveDays = Math.max(0, dayCounts.unpaidLeaveDays);
    const unpaidLeaveDeduction = money.multiply(dailyRate, unpaidLeaveDays);
    const lateCount = dayCounts.lateCount;
    const lateDeduction =
      lateCount > maxLatesBeforeDeduction
        ? money.multiply(
            money.multiply(dailyRate, lateDeductionPercent),
            lateCount - maxLatesBeforeDeduction
          )
        : 0;
    const statutoryDeductions = money.sum(pf, esi, professionalTax);
    const deductionsTotal = money.sum(
      unpaidLeaveDeduction,
      lateDeduction,
      permission.deduction,
      statutoryDeductions
    );

    // Fetch approved unbundled expense claims for this employee
    const approvedExpenses = await prisma.expenseClaim.findMany({
      where: {
        organizationId,
        employeeId,
        status: "APPROVED",
        payslipId: null,
      },
    });

    const reimbursements = money.sum(...approvedExpenses.map((exp) => exp.amount));

    const loanService = require("./loan.service");
    const loanPreview = await loanService.recoverForPayroll({
      organizationId,
      employeeId,
      month: m,
      year: y,
      commit: false,
    });
    const loanRecovery = money.round(loanPreview.total || 0);

    const grossSalary = money.sum(baseSalary, allowancesTotal, overtimePay);
    const netSalary = money.atLeastZero(
      money.subtract(
        money.sum(money.subtract(grossSalary, deductionsTotal), reimbursements),
        loanRecovery,
      ),
    );

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
        employeeCode: employee.employeeCode,
        email: employee.user?.email,
      },
      period: {
        month: m,
        year: y,
        start: toIsoKey(period.start),
        end: toIsoKey(period.end),
        days: period.days,
        daysInMonth: period.days,
        workingDays: basisDays,
        dayBasis: policy.payrollDayBasis,
        // True while the cycle is still running: the figures are a preview, not a payroll run.
        provisional: todayDate.getTime() <= period.end.getTime(),
      },
      attendanceSummary: {
        presentDays: dayCounts.presentDays,
        halfDays: dayCounts.halfDays,
        paidLeaveDays: dayCounts.paidLeaveDays,
        unpaidLeaveDays,
        lateCount,
        holidayDays: dayCounts.holidayDays,
        weekOffDays: dayCounts.weekOffDays,
        companyLeaveDays: dayCounts.companyLeaveDays,
        overtimeMinutes: totalOvertimeMinutes,
        overtimeHours,
        permissionHours: round2(approvedPermissionHours),
        permissionExcessHours: permission.excessHours,
      },
      salaryBreakdown: {
        annualCtc,
        monthlyCtc,
        baseSalary,
        hra,
        transport,
        special,
        otherAllowance,
        allowancesTotal,
        hourlyRate: money.round(hourlyRate),
        dailyRate: money.round(dailyRate),
        overtimePay,
        grossSalary,
      },
      deductions: {
        unpaidLeaveDeduction,
        lateDeduction,
        permissionDeduction: permission.deduction,
        pfDeduction: pf,
        esiDeduction: esi,
        ptDeduction: professionalTax,
        statutoryDeductions,
        loanRecovery,
        deductionsTotal: money.sum(deductionsTotal, loanRecovery),
      },
      reimbursements,
      approvedExpenses: approvedExpenses.map((e) => ({
        id: e.id,
        title: e.title,
        amount: Number(e.amount),
        category: e.category,
        date: e.date,
      })),
      netSalary,
    };
  }

  /**
   * Payroll cycle for a month: the period, the day basis, and whether the run can be generated yet.
   */
  async getPayrollCycle(organizationId, month, year) {
    const policy = await policyService.getPolicy(organizationId);
    const period = getPayrollPeriod(month, year, policy.payrollCycleStartDay, policy.payrollCycleEndDay);
    const today = await getOrgDateOnly(organizationId);
    return {
      month: parseInt(month),
      year: parseInt(year),
      start: toIsoKey(period.start),
      end: toIsoKey(period.end),
      days: period.days,
      dayBasis: policy.payrollDayBasis,
      basisDays: resolveDayBasis(policy.payrollDayBasis, period, policy.workingDaysPerMonth),
      today: toIsoKey(today),
      canGenerate: today.getTime() > period.end.getTime(),
      generateAfter: toIsoKey(period.end),
    };
  }

  /**
   * Preview every active employee who has a salary structure.
   */
  async calculateOrganizationPayroll(organizationId, month, year) {
    const employees = await prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { id: true, employeeCode: true, firstName: true },
    });

    const previews = [];
    const skipped = [];

    for (const emp of employees) {
      try {
        previews.push(await this.calculateEmployeePayroll(organizationId, emp.id, month, year));
      } catch (err) {
        skipped.push({
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          reason: err.message,
        });
      }
    }

    return { month: parseInt(month, 10), year: parseInt(year, 10), previews, skipped };
  }

  /**
   * 4. Generate payslips for the entire organization for a month/year
   */
  async generateOrganizationPayslips(organizationId, month, year) {
    const m = parseInt(month);
    const y = parseInt(year);

    // Regenerating a run that has already been approved or paid out would rewrite
    // settled amounts and silently reset the run to pending. Refuse instead.
    const lockedCount = await prisma.payslip.count({
      where: {
        organizationId,
        month: m,
        year: y,
        status: { in: LOCKED_PAYSLIP_STATUSES },
      },
    });

    if (lockedCount > 0) {
      const err = new Error(
        `Payroll for ${m}/${y} is locked: ${lockedCount} payslip(s) are already approved or disbursed. Reject them first if you need to regenerate.`
      );
      err.statusCode = 409;
      throw err;
    }

    // A cycle is generated only after its last day has ended, so the figures are final.
    const cycle = await this.getPayrollCycle(organizationId, m, y);
    if (!cycle.canGenerate) {
      const err = new Error(
        `Payroll for ${m}/${y} covers ${cycle.start} to ${cycle.end}. Generate it after ${cycle.end} ends; the preview is available now.`
      );
      err.statusCode = 422;
      throw err;
    }

    const employees = await prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE" },
    });

    const generated = [];
    const skipped = [];

    for (const emp of employees) {
      const existingPayslip = await prisma.payslip.findFirst({
        where: { organizationId, employeeId: emp.id, month: m, year: y },
        select: { id: true, status: true },
      });

      if (existingPayslip && !LOCKED_PAYSLIP_STATUSES.includes(existingPayslip.status)) {
        await prisma.expenseClaim.updateMany({
          where: { organizationId, payslipId: existingPayslip.id },
          data: { payslipId: null, status: "APPROVED" },
        });
      }

      let payroll;
      try {
        payroll = await this.calculateEmployeePayroll(organizationId, emp.id, m, y);
      } catch (err) {
        // One employee with bad data must not abort the whole run.
        skipped.push({
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          reason: err.message,
        });
        continue;
      }

      const tdsDeduction = await statutoryService.monthlyTdsForEmployee(organizationId, emp.id);
      const deductionsWithTds = money.sum(payroll.deductions.deductionsTotal, tdsDeduction);
      const netAfterTds = money.atLeastZero(money.subtract(payroll.netSalary, tdsDeduction));

      const payslipPayload = {
        workingDays: payroll.period.workingDays,
        periodStart: new Date(payroll.period.start),
        periodEnd: new Date(payroll.period.end),
        permissionDeduction: payroll.deductions.permissionDeduction || 0,
        presentDays: payroll.attendanceSummary.presentDays,
        paidLeaveDays: payroll.attendanceSummary.paidLeaveDays,
        unpaidLeaveDays: payroll.attendanceSummary.unpaidLeaveDays,
        overtimeHours: payroll.attendanceSummary.overtimeHours,
        baseSalary: payroll.salaryBreakdown.baseSalary,
        hra: payroll.salaryBreakdown.hra || 0,
        transport: payroll.salaryBreakdown.transport || 0,
        special: payroll.salaryBreakdown.special || 0,
        otherAllowance: payroll.salaryBreakdown.otherAllowance || 0,
        allowancesTotal: payroll.salaryBreakdown.allowancesTotal,
        overtimePay: payroll.salaryBreakdown.overtimePay,
        grossSalary: payroll.salaryBreakdown.grossSalary,
        unpaidLeaveDeduction: payroll.deductions.unpaidLeaveDeduction || 0,
        lateDeduction: payroll.deductions.lateDeduction || 0,
        pfDeduction: payroll.deductions.pfDeduction || 0,
        esiDeduction: payroll.deductions.esiDeduction || 0,
        ptDeduction: payroll.deductions.ptDeduction || 0,
        statutoryDeductions: payroll.deductions.statutoryDeductions || 0,
        tdsDeduction,
        loanRecovery: payroll.deductions.loanRecovery || 0,
        deductionsTotal: deductionsWithTds,
        reimbursements: payroll.reimbursements || 0,
        netSalary: netAfterTds,
        status: "PENDING_APPROVAL",
      };

      // The payslip and the claims it settles must land together — otherwise a
      // failure between them leaves claims reimbursed on paper but still open.
      const payslip = await prisma.$transaction(async (tx) => {
        const created = await tx.payslip.upsert({
          where: {
            employeeId_month_year: {
              employeeId: emp.id,
              month: m,
              year: y,
            },
          },
          update: payslipPayload,
          create: {
            organizationId,
            employeeId: emp.id,
            month: m,
            year: y,
            ...payslipPayload,
          },
        });

        if (payroll.approvedExpenses && payroll.approvedExpenses.length > 0) {
          const claimIds = payroll.approvedExpenses.map((exp) => exp.id);
          await tx.expenseClaim.updateMany({
            where: { id: { in: claimIds }, organizationId, payslipId: null },
            data: {
              payslipId: created.id,
              status: "PAID",
            },
          });
        }

        const loanService = require("./loan.service");
        await loanService.recoverForPayroll({
          organizationId,
          employeeId: emp.id,
          month: m,
          year: y,
          payslipId: created.id,
          commit: true,
          tx,
        });

        return created;
      });

      generated.push(payslip);
    }

    return {
      month: m,
      year: y,
      totalGenerated: generated.length,
      totalSkipped: skipped.length,
      skipped,
      payslips: generated,
    };
  }

  /**
   * 5. Get organization payslips with filters
   */
  async getPayslips(organizationId, query = {}) {
    const { month, year, employeeId, status } = query;
    const where = { organizationId };

    if (month) where.month = parseInt(month);
    if (year) where.year = parseInt(year);
    if (employeeId) where.employeeId = employeeId;
    if (status && status !== "ALL") where.status = status;

    return await prisma.payslip.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        expenses: {
          select: {
            id: true,
            title: true,
            category: true,
            amount: true,
            date: true,
            receiptUrl: true,
          },
        },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
  }

  /**
   * 6. Get personal payslips for logged-in employee
   */
  async getMyPayslips(userId, organizationId) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    return await prisma.payslip.findMany({
      where: { employeeId: employee.id, organizationId },
      include: {
        expenses: {
          select: {
            id: true,
            title: true,
            category: true,
            amount: true,
            date: true,
            receiptUrl: true,
          },
        },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });
  }

  /**
   * 7. Payroll Approval Workflow: Approve Batch
   */
  async approvePayrollBatch(organizationId, month, year, adminUserId, remarks) {
    const m = parseInt(month);
    const y = parseInt(year);

    const updated = await prisma.payslip.updateMany({
      where: {
        organizationId,
        month: m,
        year: y,
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      },
      data: {
        status: "APPROVED",
        approvedBy: adminUserId,
        approvedAt: new Date(),
        remarks: remarks || "Batch approved by authorized HR Admin",
      },
    });

    return {
      month: m,
      year: y,
      approvedCount: updated.count,
      status: "APPROVED",
    };
  }

  /**
   * 8. Payroll Approval Workflow: Mark Disbursed / Paid
   */
  async disbursePayrollBatch(organizationId, month, year, adminUserId, remarks) {
    const m = parseInt(month);
    const y = parseInt(year);

    const updated = await prisma.payslip.updateMany({
      where: {
        organizationId,
        month: m,
        year: y,
        status: "APPROVED",
      },
      data: {
        status: "DISBURSED",
        disbursedAt: new Date(),
        remarks: remarks || "Disbursed via corporate banking payroll channel",
      },
    });

    // Asynchronously dispatch Email & WhatsApp notifications to all employees in disbursed batch
    if (updated.count > 0) {
      prisma.payslip
        .findMany({
          where: { organizationId, month: m, year: y, status: "DISBURSED" },
          include: {
            employee: {
              include: {
                user: { select: { email: true } },
                organization: { select: { name: true, logoUrl: true } },
              },
            },
          },
        })
        .then((slips) => {
          for (const slip of slips) {
            const empName = `${slip.employee.firstName} ${slip.employee.lastName || ""}`.trim();
            const email = slip.employee.user?.email;
            const phone = slip.employee.phone;

            if (email) {
              emailService
                .sendPayslipDisbursedEmail(email, empName, {
                  month: m,
                  year: y,
                  netSalary: Number(slip.netSalary),
                  grossSalary: Number(slip.grossSalary),
                  deductionsTotal: Number(slip.deductionsTotal),
                  workingDays: slip.workingDays,
                  presentDays: slip.presentDays,
                  companyName: slip.employee.organization?.name,
                  companyLogoUrl: slip.employee.organization?.logoUrl,
                })
                .catch((e) => console.warn(`[PayrollNotification:Email] Error for ${email}:`, e.message));
            }

            if (phone) {
              whatsappService
                .sendPayslipDisbursedWhatsApp(phone, empName, {
                  month: m,
                  year: y,
                  netSalary: Number(slip.netSalary),
                })
                .catch((e) => console.warn(`[PayrollNotification:WhatsApp] Error for ${phone}:`, e.message));
            }
          }
        })
        .catch((e) => console.warn("[PayrollNotification] Batch notification error:", e.message));
    }

    return {
      month: m,
      year: y,
      disbursedCount: updated.count,
      status: "DISBURSED",
    };
  }

  /**
   * 9. Update Individual Payslip Status
   */
  async updatePayslipStatus(organizationId, payslipId, status, adminUserId, remarks) {
    const validStatuses = Object.keys(STATUS_TRANSITIONS);
    if (!validStatuses.includes(status)) {
      const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }

    // Scope by organization so a payslip id from another tenant cannot be touched.
    const existing = await prisma.payslip.findFirst({
      where: { id: payslipId, organizationId },
      select: { id: true, status: true },
    });

    if (!existing) {
      const err = new Error("Payslip not found");
      err.statusCode = 404;
      throw err;
    }

    const allowed = STATUS_TRANSITIONS[existing.status] || [];
    if (existing.status !== status && !allowed.includes(status)) {
      const err = new Error(
        `Cannot move a payslip from ${existing.status} to ${status}.` +
          (allowed.length ? ` Allowed: ${allowed.join(", ")}.` : " This status is final.")
      );
      err.statusCode = 409;
      throw err;
    }

    const data = { status, remarks };
    if (status === "APPROVED") {
      data.approvedBy = adminUserId;
      data.approvedAt = new Date();
    } else if (status === "DISBURSED") {
      data.disbursedAt = new Date();
    }

    return await prisma.$transaction(async (tx) => {
      if (status === "REJECTED") {
        await tx.expenseClaim.updateMany({
          where: { organizationId, payslipId },
          data: { payslipId: null, status: "APPROVED" },
        });
      }

      return tx.payslip.update({
        where: { id: payslipId },
        data,
      });
    });
  }

  /**
   * 10. Get Detailed Payslip with Company Letterhead, Bank Info & Amount in Words for PDF
   */
  async getPayslipDetails(organizationId, payslipId, restrictToEmployeeId = null) {
    const payslip = await prisma.payslip.findFirst({
      where: {
        id: payslipId,
        organizationId,
        ...(restrictToEmployeeId ? { employeeId: restrictToEmployeeId } : {}),
      },
      include: {
        organization: {
          select: { id: true, name: true, email: true, phone: true, createdAt: true },
        },
        employee: {
          include: {
            user: { select: { email: true } },
            department: { select: { name: true } },
            branch: { select: { name: true, address: true } },
          },
        },
      },
    });

    if (!payslip) {
      const error = new Error("Payslip not found");
      error.statusCode = 404;
      throw error;
    }

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[payslip.month - 1];

    const gross = Number(payslip.grossSalary || (Number(payslip.baseSalary) + Number(payslip.allowancesTotal) + Number(payslip.overtimePay)));
    const net = Number(payslip.netSalary);

    const template = await prisma.payslipTemplate.findUnique({
      where: { organizationId },
    });

    const companyDisplayName = template?.companyName || payslip.organization.name || "WorkPulse Enterprise";
    const companyDisplayAddress = template?.addressLine1
      ? `${template.addressLine1}${template.addressLine2 ? ", " + template.addressLine2 : ""}`
      : (payslip.employee.branch?.address || "Corporate Headquarters, Cyber City, Phase II");

    return {
      payslipId: payslip.id,
      referenceNo: `WP-PAY-${payslip.year}-${String(payslip.month).padStart(2, "0")}-${payslip.employee.employeeCode}`,
      template: template || null,
      period: {
        month: payslip.month,
        monthName,
        year: payslip.year,
        periodLabel: `${monthName} ${payslip.year}`,
      },
      organization: {
        name: companyDisplayName,
        address: companyDisplayAddress,
        logoUrl: template?.logoUrl || payslip.organization.logoUrl,
        taxIdentifierLabel: template?.taxIdentifierLabel || "CIN / GSTIN",
        taxIdentifierValue: template?.taxIdentifierValue || null,
        contactEmail: template?.contactEmail || payslip.organization.email,
        contactPhone: template?.contactPhone || payslip.organization.phone,
      },
      employee: {
        id: payslip.employee.id,
        name: `${payslip.employee.firstName} ${payslip.employee.lastName || ""}`.trim(),
        employeeCode: payslip.employee.employeeCode,
        designation: payslip.employee.designation || "Staff Professional",
        department: payslip.employee.department?.name || "General",
        branch: payslip.employee.branch?.name || "Main Campus",
        email: payslip.employee.user?.email || "N/A",
        phone: payslip.employee.phone || "N/A",
        dateOfJoining: payslip.employee.dateOfJoining ? payslip.employee.dateOfJoining.toISOString().split("T")[0] : "N/A",
        panNumber: payslip.employee.panNumber || null,
        uanNumber: payslip.employee.uanNumber || null,
        bankName: payslip.employee.bankName || null,
        accountNumber: payslip.employee.bankAccountNumber
          ? maskAccount(payslip.employee.bankAccountNumber)
          : null,
        ifscCode: payslip.employee.bankIfsc || null,
      },
      attendance: {
        workingDays: payslip.workingDays,
        presentDays: Number(payslip.presentDays),
        paidLeaveDays: Number(payslip.paidLeaveDays),
        unpaidLeaveDays: Number(payslip.unpaidLeaveDays),
        overtimeHours: Number(payslip.overtimeHours),
      },
      earnings: [
        { label: "Basic Salary", amount: Number(payslip.baseSalary) },
        { label: "House Rent Allowance (HRA)", amount: Number(payslip.hra || 0) },
        { label: "Transport Allowance", amount: Number(payslip.transport || 0) },
        { label: "Special Allowance", amount: Number(payslip.special || 0) },
        ...(Number(payslip.otherAllowance || 0) > 0 ? [{ label: "Other Allowance", amount: Number(payslip.otherAllowance) }] : []),
        ...(Number(payslip.overtimePay || 0) > 0 ? [{ label: `Overtime Pay (${payslip.overtimeHours} hrs)`, amount: Number(payslip.overtimePay) }] : []),
      ],
      deductions: [
        ...(Number(payslip.unpaidLeaveDeduction || 0) > 0 ? [{ label: `Loss of Pay (LWP - ${payslip.unpaidLeaveDays} days)`, amount: Number(payslip.unpaidLeaveDeduction) }] : []),
        ...(Number(payslip.lateDeduction || 0) > 0 ? [{ label: "Late Arrival Deduction", amount: Number(payslip.lateDeduction) }] : []),
        { label: "Provident Fund (PF)", amount: Number(payslip.pfDeduction || 0) },
        { label: "Employee State Insurance (ESI)", amount: Number(payslip.esiDeduction || 0) },
        { label: "Professional Tax (PT)", amount: Number(payslip.ptDeduction || 0) },
      ],
      totals: {
        grossSalary: gross,
        totalDeductions: Number(payslip.deductionsTotal),
        netSalary: net,
        netSalaryInWords: `${this._convertNumberToWords(net)} Rupees Only`,
      },
      governance: {
        status: payslip.status,
        approvedBy: payslip.approvedBy || "System Administrator",
        approvedAt: payslip.approvedAt,
        disbursedAt: payslip.disbursedAt,
        remarks: payslip.remarks,
        generatedAt: payslip.createdAt,
      },
    };
  }

  /**
   * 11. Comprehensive Payroll Reports Engine (Departmental, Bank Advice, Statutory PF/ESI/PT)
   */
  async getPayrollReports(organizationId, month, year) {
    const m = parseInt(month);
    const y = parseInt(year);

    const payslips = await prisma.payslip.findMany({
      where: { organizationId, month: m, year: y },
      include: {
        employee: {
          include: {
            department: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });

    // 1. Executive Summary
    const totalEmployees = payslips.length;
    let totalGross = 0;
    let totalNet = 0;
    let totalDeductions = 0;
    let totalOvertimePay = 0;
    let totalPf = 0;
    let totalEsi = 0;
    let totalPt = 0;

    // 2. Department Breakdown
    const deptMap = {};

    // 3. Bank Disbursement Advice
    const bankAdvice = [];

    payslips.forEach((p) => {
      const gross = Number(p.grossSalary || (Number(p.baseSalary) + Number(p.allowancesTotal) + Number(p.overtimePay)));
      const net = Number(p.netSalary);
      const deductions = Number(p.deductionsTotal);
      const ot = Number(p.overtimePay || 0);
      const pf = Number(p.pfDeduction || 0);
      const esi = Number(p.esiDeduction || 0);
      const pt = Number(p.ptDeduction || 0);

      totalGross += gross;
      totalNet += net;
      totalDeductions += deductions;
      totalOvertimePay += ot;
      totalPf += pf;
      totalEsi += esi;
      totalPt += pt;

      // Department aggregation
      const deptName = p.employee?.department?.name || "General Management";
      if (!deptMap[deptName]) {
        deptMap[deptName] = { department: deptName, employeeCount: 0, grossTotal: 0, netTotal: 0 };
      }
      deptMap[deptName].employeeCount += 1;
      deptMap[deptName].grossTotal += gross;
      deptMap[deptName].netTotal += net;

      // Bank advice row
      bankAdvice.push({
        id: p.id,
        employeeCode: p.employee?.employeeCode,
        employeeName: `${p.employee?.firstName} ${p.employee?.lastName || ""}`.trim(),
        department: deptName,
        bankName: p.employee?.bankName || null,
        accountNumber: p.employee?.bankAccountNumber
          ? maskAccount(p.employee.bankAccountNumber)
          : null,
        ifsc: p.employee?.bankIfsc || null,
        grossSalary: gross,
        deductionsTotal: deductions,
        netDisbursed: net,
        status: p.status,
      });
    });

    const departmentBreakdown = Object.values(deptMap);

    // Statutory Compliance Report (Employee + Employer liability)
    const employerPf = totalPf; // standard 1:1 match up to 12%
    const employerEsi = Math.round(totalGross * 0.0325); // standard employer 3.25%
    const statutoryCompliance = {
      pfEmployee: totalPf,
      pfEmployer: employerPf,
      pfTotal: totalPf + employerPf,
      esiEmployee: totalEsi,
      esiEmployer: employerEsi,
      esiTotal: totalEsi + employerEsi,
      professionalTax: totalPt,
      totalStatutoryLiability: totalPf + employerPf + totalEsi + employerEsi + totalPt,
    };

    return {
      period: { month: m, year: y },
      executiveSummary: {
        totalEmployees,
        totalGross: Math.round(totalGross),
        totalNet: Math.round(totalNet),
        totalDeductions: Math.round(totalDeductions),
        totalOvertimePay: Math.round(totalOvertimePay),
        averageNetSalary: totalEmployees > 0 ? Math.round(totalNet / totalEmployees) : 0,
      },
      departmentBreakdown,
      statutoryCompliance,
      bankDisbursementAdvice: bankAdvice,
    };
  }

  /**
   * 12. Employee Salary History & Audit Trail Engine
   */
  async getEmployeeSalaryHistory(organizationId, employeeId) {
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: {
        salaryStructure: true,
        department: { select: { name: true } },
      },
    });

    if (!employee) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }

    const revisions = await prisma.salaryRevision.findMany({
      where: { organizationId, employeeId },
      orderBy: { effectiveDate: "desc" },
    });

    const historicalPayslips = await prisma.payslip.findMany({
      where: { organizationId, employeeId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 12,
    });

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        department: employee.department?.name,
      },
      currentSalaryStructure: employee.salaryStructure,
      revisions,
      historicalPayslips,
    };
  }

  /**
   * 13. Record a New Salary Revision (Increment, Promotion, Appraisal)
   */
  async recordSalaryRevision(organizationId, data, adminUserId) {
    const {
      employeeId,
      annualCtc,
      monthlyCtc,
      baseSalary,
      hra = 0,
      transport = 0,
      transportAllowance,
      special = 0,
      specialAllowance,
      otherAllowance = 0,
      pf = 0,
      esi = 0,
      professionalTax = 0,
      effectiveDate,
      revisionReason,
    } = data;

    if (!employeeId || !annualCtc || !baseSalary) {
      const error = new Error("employeeId, annualCtc, and baseSalary are required");
      error.statusCode = 400;
      throw error;
    }

    const currentStructure = await prisma.salaryStructure.findFirst({
      where: { organizationId, employeeId },
    });

    const prevAnnual = currentStructure?.annualCtc ? Number(currentStructure.annualCtc) : null;
    const newAnnual = Number(annualCtc);
    const hike = prevAnnual && prevAnnual > 0 ? Number((((newAnnual - prevAnnual) / prevAnnual) * 100).toFixed(2)) : null;

    const finalTransport = transport !== undefined ? transport : (transportAllowance || 0);
    const finalSpecial = special !== undefined ? special : (specialAllowance || 0);
    const finalMonthlyCtc = monthlyCtc ? Number(monthlyCtc) : Math.round(newAnnual / 12);

    // 1. Create SalaryRevision audit log
    const revision = await prisma.salaryRevision.create({
      data: {
        organizationId,
        employeeId,
        annualCtc: newAnnual,
        monthlyCtc: finalMonthlyCtc,
        baseSalary: Number(baseSalary),
        hra: Number(hra),
        transport: Number(finalTransport),
        special: Number(finalSpecial),
        otherAllowance: Number(otherAllowance),
        pf: Number(pf),
        esi: Number(esi),
        professionalTax: Number(professionalTax),
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        revisionReason: revisionReason || "ANNUAL_APPRAISAL",
        hikePercentage: hike,
        previousAnnualCtc: prevAnnual,
        revisedByUserId: adminUserId,
      },
    });

    // 2. Update active SalaryStructure
    await this.upsertSalaryStructure(organizationId, {
      employeeId,
      annualCtc: newAnnual,
      monthlyCtc: finalMonthlyCtc,
      baseSalary,
      hra,
      transport: finalTransport,
      special: finalSpecial,
      otherAllowance,
      pf,
      esi,
      professionalTax,
    });

    return revision;
  }

  /**
   * Internal Helper: Convert currency number to formal English words
   */
  _convertNumberToWords(amount) {
    const num = Math.floor(Math.abs(amount));
    if (num === 0) return "Zero";

    const a = [
      "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
      "Seventeen", "Eighteen", "Nineteen"
    ];
    const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

    const formatHundreds = (n) => {
      let str = "";
      if (n > 99) {
        str += a[Math.floor(n / 100)] + " Hundred ";
        n %= 100;
      }
      if (n > 19) {
        str += b[Math.floor(n / 10)] + " " + a[n % 10];
      } else if (n > 0) {
        str += a[n];
      }
      return str.trim();
    };

    let result = "";
    const crores = Math.floor(num / 10000000);
    const lakhs = Math.floor((num % 10000000) / 100000);
    const thousands = Math.floor((num % 100000) / 1000);
    const remainder = num % 1000;

    if (crores > 0) result += `${formatHundreds(crores)} Crore `;
    if (lakhs > 0) result += `${formatHundreds(lakhs)} Lakh `;
    if (thousands > 0) result += `${formatHundreds(thousands)} Thousand `;
    if (remainder > 0) result += formatHundreds(remainder);

    return result.trim();
  }
}

module.exports = new PayrollService();
