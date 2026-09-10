const prisma = require("../config/database");

class PayrollService {
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
   * 2. Get salary structure for employee
   */
  async getSalaryStructure(organizationId, employeeId) {
    return await prisma.salaryStructure.findFirst({
      where: { organizationId, employeeId },
    });
  }

  /**
   * 3. Calculate attendance-driven payroll for an employee in a given month/year
   */
  async calculateEmployeePayroll(organizationId, employeeId, month, year) {
    const m = parseInt(month);
    const y = parseInt(year);

    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 0)); // last day of month

    const daysInMonth = endDate.getUTCDate();
    const standardWorkingDays = 22; // default standard working days

    // Fetch employee and salary structure
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: {
        salaryStructure: true,
        user: { select: { email: true } },
      },
    });

    if (!employee) {
      const error = new Error("Employee not found");
      error.statusCode = 404;
      throw error;
    }

    const salary = employee.salaryStructure || {
      annualCtc: 600000,
      monthlyCtc: 50000,
      baseSalary: 25000,
      hra: 12500,
      transport: 3000,
      special: 6500,
      otherAllowance: 0,
      pf: 1800,
      esi: 0,
      professionalTax: 200,
      overtimeRate: 1.5,
    };

    const annualCtc = salary.annualCtc ? Number(salary.annualCtc) : null;
    const monthlyCtc = salary.monthlyCtc ? Number(salary.monthlyCtc) : null;
    const baseSalary = Number(salary.baseSalary);
    const hra = Number(salary.hra);
    const transport = Number(salary.transport);
    const special = Number(salary.special);
    const otherAllowance = Number(salary.otherAllowance || 0);
    const allowancesTotal = hra + transport + special + otherAllowance;
    const pf = Number(salary.pf || 0);
    const esi = Number(salary.esi || 0);
    const professionalTax = Number(salary.professionalTax || 0);
    const overtimeMultiplier = Number(salary.overtimeRate) || 1.5;

    const dailyRate = baseSalary / standardWorkingDays;
    const hourlyRate = dailyRate / 8;

    // Fetch all attendance records for this employee in this month
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId,
        organizationId,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    let presentDays = 0;
    let halfDays = 0;
    let totalOvertimeMinutes = 0;
    let lateCount = 0;
    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;

    attendances.forEach((att) => {
      if (att.status === "PRESENT") presentDays += 1;
      else if (att.status === "LATE") {
        presentDays += 1;
        lateCount += 1;
      } else if (att.status === "HALF_DAY") {
        halfDays += 1;
        presentDays += 0.5;
      } else if (att.status === "ON_LEAVE") {
        paidLeaveDays += 1;
      }
      totalOvertimeMinutes += att.overtimeMinutes || 0;
    });

    const overtimeHours = Math.round((totalOvertimeMinutes / 60) * 10) / 10;
    const overtimePay = Math.round(overtimeHours * hourlyRate * overtimeMultiplier);

    // Calculate unpaid leave days (e.g. if presentDays + paidLeaveDays < workingDays)
    const effectiveDays = presentDays + paidLeaveDays;
    if (effectiveDays < standardWorkingDays) {
      unpaidLeaveDays = Math.max(0, standardWorkingDays - effectiveDays);
    }

    const unpaidLeaveDeduction = Math.round(unpaidLeaveDays * dailyRate);
    const lateDeduction = lateCount > 3 ? (lateCount - 3) * Math.round(dailyRate * 0.25) : 0;
    const statutoryDeductions = pf + esi + professionalTax;
    const deductionsTotal = unpaidLeaveDeduction + lateDeduction + statutoryDeductions;

    const grossSalary = baseSalary + allowancesTotal + overtimePay;
    const netSalary = Math.max(0, grossSalary - deductionsTotal);

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
        daysInMonth,
        workingDays: standardWorkingDays,
      },
      attendanceSummary: {
        presentDays,
        halfDays,
        paidLeaveDays,
        unpaidLeaveDays,
        lateCount,
        overtimeMinutes: totalOvertimeMinutes,
        overtimeHours,
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
        hourlyRate: Math.round(hourlyRate),
        dailyRate: Math.round(dailyRate),
        overtimePay,
        grossSalary,
      },
      deductions: {
        unpaidLeaveDeduction,
        lateDeduction,
        pfDeduction: pf,
        esiDeduction: esi,
        ptDeduction: professionalTax,
        statutoryDeductions,
        deductionsTotal,
      },
      netSalary,
    };
  }

  /**
   * 4. Generate payslips for the entire organization for a month/year
   */
  async generateOrganizationPayslips(organizationId, month, year) {
    const m = parseInt(month);
    const y = parseInt(year);

    const employees = await prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE" },
    });

    const generated = [];

    for (const emp of employees) {
      const payroll = await this.calculateEmployeePayroll(organizationId, emp.id, m, y);

      const payslipPayload = {
        workingDays: payroll.period.workingDays,
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
        deductionsTotal: payroll.deductions.deductionsTotal,
        netSalary: payroll.netSalary,
        status: "PENDING_APPROVAL",
      };

      const payslip = await prisma.payslip.upsert({
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

      generated.push(payslip);
    }

    return {
      month: m,
      year: y,
      totalGenerated: generated.length,
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
    const validStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "DISBURSED", "REJECTED"];
    if (!validStatuses.includes(status)) {
      const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }

    const data = { status, remarks };
    if (status === "APPROVED") {
      data.approvedBy = adminUserId;
      data.approvedAt = new Date();
    } else if (status === "DISBURSED") {
      data.disbursedAt = new Date();
    }

    return await prisma.payslip.update({
      where: { id: payslipId },
      data,
    });
  }

  /**
   * 10. Get Detailed Payslip with Company Letterhead, Bank Info & Amount in Words for PDF
   */
  async getPayslipDetails(organizationId, payslipId) {
    const payslip = await prisma.payslip.findFirst({
      where: { id: payslipId, organizationId },
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

    return {
      payslipId: payslip.id,
      referenceNo: `WP-PAY-${payslip.year}-${String(payslip.month).padStart(2, "0")}-${payslip.employee.employeeCode}`,
      period: {
        month: payslip.month,
        monthName,
        year: payslip.year,
        periodLabel: `${monthName} ${payslip.year}`,
      },
      organization: {
        name: payslip.organization.name || "WorkPulse Enterprise",
        address: payslip.employee.branch?.address || "Corporate Headquarters, Cyber City, Phase II",
        logoUrl: payslip.organization.logoUrl,
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
        // Statutory & Bank identifiers placeholder / standard fallback
        panNumber: "ABCDE1234F",
        bankName: "HDFC Bank Ltd.",
        accountNumber: "••••••••4892",
        ifscCode: "HDFC0001824",
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
        bankName: "Corporate Salary Partner (HDFC)",
        accountNumber: `XXXX${Math.floor(1000 + Math.random() * 9000)}`,
        ifsc: "HDFC0001824",
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
