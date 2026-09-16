const prisma = require("../config/database");
const notificationService = require("./notification.service");
const { getPolicy } = require("./attendance.service");

// Standard Departmental Clearances Checklist
const DEFAULT_CLEARANCE_TEMPLATES = [
  {
    department: "IT_ASSETS",
    itemName: "Laptop, Charger & Peripheral Return",
    itemDescription: "Collect company laptop, power adapter, external monitors, and accessories in good condition",
  },
  {
    department: "IT_ASSETS",
    itemName: "Corporate Email & SaaS Access Revocation",
    itemDescription: "Suspend Google Workspace / Microsoft 365, GitHub, VPN, and internal system credentials",
  },
  {
    department: "REPORTING_MANAGER",
    itemName: "Project Handover & Documentation",
    itemDescription: "Handover of active sprint deliverables, client passwords, and code/design assets to designated successor",
  },
  {
    department: "REPORTING_MANAGER",
    itemName: "Manager Exit Clearance Sign-off",
    itemDescription: "Verification that all operational dependencies and KT sessions are 100% completed",
  },
  {
    department: "FINANCE_PAYROLL",
    itemName: "Company Expense & Travel Claim Settlement",
    itemDescription: "Verify all corporate credit cards, travel receipts, and petty cash advances are submitted & settled",
  },
  {
    department: "FINANCE_PAYROLL",
    itemName: "Loans, Salary Advances & Imprest Recovery",
    itemDescription: "Check for outstanding salary advances or employee loans for recovery in F&F",
  },
  {
    department: "HR_OPERATIONS",
    itemName: "Exit Interview Conducted",
    itemDescription: "Complete confidential exit interview feedback questionnaire",
  },
  {
    department: "HR_OPERATIONS",
    itemName: "ID Badge, Access Cards & Health Insurance",
    itemDescription: "Collect physical office RFID badge, parking permit, and initiate group insurance de-enrollment",
  },
  {
    department: "ADMIN_FACILITY",
    itemName: "Office Locker & Pedestal Key Handover",
    itemDescription: "Inspect employee physical workstation, return office locker keys and company property",
  },
];

class OffboardingService {
  /**
   * 1. Initiate Employee Exit (Resignation or Involuntary Termination)
   */
  async initiateExit(organizationId, payload, initiatedByUser) {
    const {
      employeeId,
      exitType = "RESIGNATION",
      resignationDate,
      preferredLastWorkingDate,
      noticePeriodDays = 30,
      reason,
      employeeComments,
    } = payload;

    if (!employeeId || !reason) {
      const error = new Error("employeeId and reason are required");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
      include: { user: true, department: true, branch: true },
    });

    if (!employee) {
      const error = new Error("Employee not found in this organization");
      error.statusCode = 404;
      throw error;
    }

    // Check if an active exit request already exists
    const existingExit = await prisma.employeeExit.findFirst({
      where: {
        employeeId,
        organizationId,
        status: { notIn: ["TERMINATED", "REJECTED", "WITHDRAWN"] },
      },
    });

    if (existingExit) {
      const error = new Error(`An active exit process is already running for this employee (Status: ${existingExit.status})`);
      error.statusCode = 400;
      throw error;
    }

    const resDate = resignationDate ? new Date(resignationDate) : new Date();
    const noticeDays = Number(noticePeriodDays) || 30;

    // Default calculated last working date
    let lwd = preferredLastWorkingDate ? new Date(preferredLastWorkingDate) : new Date(resDate);
    if (!preferredLastWorkingDate) {
      lwd.setDate(lwd.getDate() + noticeDays);
    }

    const isHrInitiated = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"].includes(initiatedByUser?.role);
    const initialStatus = isHrInitiated && exitType === "TERMINATION" ? "NOTICE_PERIOD" : "RESIGNED";

    // 1. Create Exit Record
    const exitRecord = await prisma.employeeExit.create({
      data: {
        organizationId,
        employeeId,
        exitType,
        status: initialStatus,
        resignationDate: resDate,
        preferredLastWorkingDate: lwd,
        approvedLastWorkingDate: isHrInitiated ? lwd : null,
        noticePeriodDays: noticeDays,
        reason: reason.trim(),
        employeeComments: employeeComments ? employeeComments.trim() : null,
        hrReviewerId: isHrInitiated ? initiatedByUser.id : null,
        hrReviewedAt: isHrInitiated ? new Date() : null,
      },
    });

    // 2. Auto-populate Departmental Clearance Tasks
    for (const item of DEFAULT_CLEARANCE_TEMPLATES) {
      await prisma.employeeClearance.create({
        data: {
          organizationId,
          exitId: exitRecord.id,
          department: item.department,
          itemName: item.itemName,
          itemDescription: item.itemDescription,
          status: "PENDING",
        },
      });
    }

    // 3. Dispatch Notifications
    try {
      if (!isHrInitiated) {
        // Notify Admins about new resignation
        const admins = await prisma.user.findMany({
          where: {
            organizationId,
            role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"] },
          },
          select: { id: true },
        });

        for (const admin of admins) {
          await notificationService.createNotification({
            organizationId,
            userId: admin.id,
            title: "🚨 New Resignation Submitted",
            message: `${employee.firstName} ${employee.lastName || ""} (${employee.employeeCode}) has submitted their resignation. Proposed LWD: ${lwd.toISOString().split("T")[0]}.`,
            type: "SYSTEM",
          });
        }
      }
    } catch (notifErr) {
      console.warn("Notification dispatch failed:", notifErr.message);
    }

    return await this.getExitDetails(organizationId, exitRecord.id);
  }

  /**
   * 2. HR / Admin Review of Resignation
   */
  async reviewResignation(organizationId, exitId, payload, reviewerUser) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
      include: { employee: { include: { user: true } } },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    const {
      action, // APPROVE, REJECT
      approvedLastWorkingDate,
      noticePeriodDays,
      isNoticeWaived = false,
      waivedNoticeDays = 0,
      hrNotes,
    } = payload;

    if (!["APPROVE", "REJECT"].includes(action)) {
      const error = new Error("Action must be APPROVE or REJECT");
      error.statusCode = 400;
      throw error;
    }

    if (action === "REJECT") {
      const rejectedExit = await prisma.employeeExit.update({
        where: { id: exitId },
        data: {
          status: "REJECTED",
          hrNotes: hrNotes ? hrNotes.trim() : "Resignation request rejected by HR",
          hrReviewerId: reviewerUser.id,
          hrReviewedAt: new Date(),
        },
      });

      if (exit.employee?.user?.id) {
        await notificationService.createNotification({
          organizationId,
          userId: exit.employee.user.id,
          title: "Resignation Request Rejected",
          message: `Your resignation request was reviewed and not accepted. Notes: ${hrNotes || "Please connect with HR."}`,
          type: "SYSTEM",
        });
      }

      return rejectedExit;
    }

    // Action === APPROVE
    const approvedLwd = approvedLastWorkingDate
      ? new Date(approvedLastWorkingDate)
      : exit.preferredLastWorkingDate || new Date();

    const updated = await prisma.employeeExit.update({
      where: { id: exitId },
      data: {
        status: "NOTICE_PERIOD",
        approvedLastWorkingDate: approvedLwd,
        noticePeriodDays: noticePeriodDays !== undefined ? Number(noticePeriodDays) : exit.noticePeriodDays,
        isNoticeWaived: Boolean(isNoticeWaived),
        waivedNoticeDays: Number(waivedNoticeDays) || 0,
        hrNotes: hrNotes ? hrNotes.trim() : null,
        hrReviewerId: reviewerUser.id,
        hrReviewedAt: new Date(),
      },
    });

    if (exit.employee?.user?.id) {
      const lwdStr = approvedLwd.toISOString().split("T")[0];
      await notificationService.createNotification({
        organizationId,
        userId: exit.employee.user.id,
        title: "Resignation Accepted - Notice Period Active",
        message: `Your resignation has been accepted. Your approved Last Working Day (LWD) is ${lwdStr}. Department clearances are now initiated.`,
        type: "SYSTEM",
      });
    }

    return await this.getExitDetails(organizationId, exitId);
  }

  /**
   * 3. Get Exit Pipeline List
   */
  async getExitList(organizationId, filters = {}) {
    const { status, search } = filters;
    const where = { organizationId };

    if (status && status !== "ALL") {
      where.status = status;
    }

    if (search) {
      where.employee = {
        OR: [
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { employeeCode: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const exits = await prisma.employeeExit.findMany({
      where,
      include: {
        employee: {
          include: {
            user: { select: { email: true, role: true } },
            department: { select: { name: true } },
            branch: { select: { name: true } },
          },
        },
        clearances: true,
        finalSettlement: true,
        interview: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return exits.map((exit) => {
      const totalClearances = exit.clearances.length;
      const clearedCount = exit.clearances.filter((c) => ["CLEARED", "WAIVED"].includes(c.status)).length;
      const clearanceProgress = totalClearances > 0 ? Math.round((clearedCount / totalClearances) * 100) : 100;

      return {
        ...exit,
        metrics: {
          totalClearances,
          clearedCount,
          pendingClearances: totalClearances - clearedCount,
          clearanceProgress,
          hasSettlement: Boolean(exit.finalSettlement),
          settlementStatus: exit.finalSettlement?.status || "NOT_GENERATED",
          netSettlementPayable: exit.finalSettlement ? Number(exit.finalSettlement.netPayable) : null,
        },
      };
    });
  }

  /**
   * 4. Get Exit Details
   */
  async getExitDetails(organizationId, exitId) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
      include: {
        employee: {
          include: {
            user: { select: { id: true, email: true, role: true } },
            department: true,
            branch: true,
            shift: true,
            salaryStructure: true,
            leaveBalances: { include: { leaveType: true } },
          },
        },
        clearances: { orderBy: [{ department: "asc" }, { createdAt: "asc" }] },
        interview: true,
        finalSettlement: true,
      },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    const totalClearances = exit.clearances.length;
    const clearedCount = exit.clearances.filter((c) => ["CLEARED", "WAIVED"].includes(c.status)).length;
    const clearanceProgress = totalClearances > 0 ? Math.round((clearedCount / totalClearances) * 100) : 100;
    const allClearancesApproved = totalClearances > 0 && clearedCount === totalClearances;

    // Group clearances by department
    const clearancesByDept = {};
    for (const c of exit.clearances) {
      if (!clearancesByDept[c.department]) clearancesByDept[c.department] = [];
      clearancesByDept[c.department].push(c);
    }

    return {
      ...exit,
      metrics: {
        totalClearances,
        clearedCount,
        pendingClearances: totalClearances - clearedCount,
        clearanceProgress,
        allClearancesApproved,
      },
      clearancesByDept,
    };
  }

  /**
   * 5. Update Department Clearance Item
   */
  async updateClearanceItem(organizationId, exitId, clearanceId, payload, reviewerUser) {
    const clearance = await prisma.employeeClearance.findFirst({
      where: { id: clearanceId, exitId, organizationId },
    });

    if (!clearance) {
      const error = new Error("Clearance item not found");
      error.statusCode = 404;
      throw error;
    }

    const { status, recoveryAmount = 0, remarks } = payload;
    if (!["PENDING", "CLEARED", "RECOVERABLE_DUE", "WAIVED"].includes(status)) {
      const error = new Error("Invalid clearance status");
      error.statusCode = 400;
      throw error;
    }

    const reviewerName = reviewerUser.employee
      ? `${reviewerUser.employee.firstName} ${reviewerUser.employee.lastName || ""}`.trim()
      : reviewerUser.email;

    const updated = await prisma.employeeClearance.update({
      where: { id: clearanceId },
      data: {
        status,
        recoveryAmount: Number(recoveryAmount) || 0,
        remarks: remarks !== undefined ? remarks : clearance.remarks,
        clearedBy: ["CLEARED", "WAIVED"].includes(status) ? reviewerName : null,
        clearedAt: ["CLEARED", "WAIVED"].includes(status) ? new Date() : null,
      },
    });

    // Check if exit status should advance to CLEARANCE_IN_PROGRESS or SETTLEMENT_CALCULATED
    const allClearances = await prisma.employeeClearance.findMany({ where: { exitId } });
    const allCleared = allClearances.every((c) => ["CLEARED", "WAIVED"].includes(c.status));

    const exit = await prisma.employeeExit.findUnique({ where: { id: exitId } });
    if (exit && ["NOTICE_PERIOD", "RESIGNED"].includes(exit.status)) {
      await prisma.employeeExit.update({
        where: { id: exitId },
        data: { status: "CLEARANCE_IN_PROGRESS" },
      });
    }

    return updated;
  }

  /**
   * 6. Save Exit Interview Feedback
   */
  async saveExitInterview(organizationId, exitId, payload, reviewerUser) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    const {
      reasonCategory,
      feedbackRatings,
      whatWeDidWell,
      whatCanWeImprove,
      wouldRecommendCompany = true,
      notes,
    } = payload;

    const interviewerName = reviewerUser.employee
      ? `${reviewerUser.employee.firstName} ${reviewerUser.employee.lastName || ""}`.trim()
      : reviewerUser.email;

    const interview = await prisma.exitInterview.upsert({
      where: { exitId },
      create: {
        organizationId,
        exitId,
        reasonCategory,
        feedbackRatings: feedbackRatings || {},
        whatWeDidWell,
        whatCanWeImprove,
        wouldRecommendCompany: Boolean(wouldRecommendCompany),
        conductedBy: interviewerName,
        conductedAt: new Date(),
        notes,
      },
      update: {
        reasonCategory,
        feedbackRatings: feedbackRatings || {},
        whatWeDidWell,
        whatCanWeImprove,
        wouldRecommendCompany: Boolean(wouldRecommendCompany),
        conductedBy: interviewerName,
        conductedAt: new Date(),
        notes,
      },
    });

    return interview;
  }

  /**
   * 7. Calculate Full & Final (F&F) Settlement
   * Connects to payroll, attendance, remaining leave balances, and clearances:
   *   Final Salary
   *   + Overtime
   *   + Leave Encashment
   *   + Reimbursements
   *   + Other Earnings
   *   - LOP
   *   - Loan/Advance
   *   - Notice Shortfall
   *   - Asset/Other Recoveries
   *   = Net Final Settlement
   */
  async calculateFinalSettlement(organizationId, exitId, customOverrides = {}) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
      include: {
        employee: {
          include: {
            salaryStructure: true,
            leaveBalances: { include: { leaveType: true } },
            expenses: { where: { status: "APPROVED", payslipId: null } },
          },
        },
        clearances: true,
      },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    const { employee } = exit;
    const salary = employee.salaryStructure;

    // Determine monthly base salary and daily rate
    const monthlyCtc = salary ? Number(salary.monthlyCtc || salary.baseSalary) : 30000;
    const baseSalary = salary ? Number(salary.baseSalary) : monthlyCtc * 0.5;

    const policy = await getPolicy(organizationId);
    const standardWorkingDays = policy.workingDaysPerMonth || 26;
    const dailyRate = Math.round((baseSalary / standardWorkingDays) * 100) / 100;

    // 1. Calculate Worked Days in Final Month
    const lwd = exit.approvedLastWorkingDate || exit.preferredLastWorkingDate || new Date();
    const finalMonthDay = lwd.getDate();
    // Cap worked days to standard working days
    const workedDaysInFinalMonth = Math.min(finalMonthDay, standardWorkingDays);
    const calculatedFinalSalary = Math.round(workedDaysInFinalMonth * dailyRate * 100) / 100;

    // 2. Overtime Pay
    const overtimePay = 0; // can be adjusted via customOverrides

    // 3. Leave Encashment
    // Find unutilized paid leave balance (e.g. Privilege Leave / Paid Leave / Annual Leave)
    const paidLeaveBalanceRecord = employee.leaveBalances.find(
      (b) => b.leaveType.name.toLowerCase().includes("privilege") ||
             b.leaveType.name.toLowerCase().includes("annual") ||
             b.leaveType.name.toLowerCase().includes("paid")
    ) || employee.leaveBalances[0];

    const availableLeaves = paidLeaveBalanceRecord ? Math.max(0, Number(paidLeaveBalanceRecord.balance)) : 0;
    const leaveEncashmentDays = customOverrides.leaveEncashmentDays !== undefined
      ? Number(customOverrides.leaveEncashmentDays)
      : availableLeaves;
    const leaveEncashmentAmount = Math.round(leaveEncashmentDays * dailyRate * 100) / 100;

    // 4. Pending Reimbursements (approved expense claims not yet paid in payslip)
    const pendingExpensesTotal = employee.expenses.reduce(
      (sum, exp) => sum + Number(exp.amount),
      0
    );
    const pendingReimbursements = customOverrides.pendingReimbursements !== undefined
      ? Number(customOverrides.pendingReimbursements)
      : pendingExpensesTotal;

    // 5. Asset Recovery Amount (summed from clearances flagged as RECOVERABLE_DUE)
    const assetRecoveryCalculated = exit.clearances.reduce(
      (sum, cl) => sum + Number(cl.recoveryAmount || 0),
      0
    );
    const assetRecoveryAmount = customOverrides.assetRecoveryAmount !== undefined
      ? Number(customOverrides.assetRecoveryAmount)
      : assetRecoveryCalculated;

    // 6. Notice Shortfall Recovery
    // If notice was not waived and employee preferred LWD was earlier than mandatory notice
    let noticeShortfallDays = 0;
    let noticeShortfallDeduction = 0;
    if (!exit.isNoticeWaived && exit.approvedLastWorkingDate && exit.resignationDate) {
      const actualNoticeDays = Math.ceil(
        (new Date(exit.approvedLastWorkingDate).getTime() - new Date(exit.resignationDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (actualNoticeDays < exit.noticePeriodDays) {
        noticeShortfallDays = exit.noticePeriodDays - actualNoticeDays;
        noticeShortfallDeduction = Math.round(noticeShortfallDays * dailyRate * 100) / 100;
      }
    }

    // Apply any custom overrides
    const finalSalaryPayable = customOverrides.finalSalaryPayable !== undefined ? Number(customOverrides.finalSalaryPayable) : calculatedFinalSalary;
    const gratuityOrBonus = customOverrides.gratuityOrBonus !== undefined ? Number(customOverrides.gratuityOrBonus) : 0;
    const otherEarnings = customOverrides.otherEarnings !== undefined ? Number(customOverrides.otherEarnings) : 0;

    const lopDays = customOverrides.lopDays !== undefined ? Number(customOverrides.lopDays) : 0;
    const lopDeduction = customOverrides.lopDeduction !== undefined ? Number(customOverrides.lopDeduction) : Math.round(lopDays * dailyRate * 100) / 100;
    const loanOrAdvanceRecovery = customOverrides.loanOrAdvanceRecovery !== undefined ? Number(customOverrides.loanOrAdvanceRecovery) : 0;
    const statutoryDeductions = customOverrides.statutoryDeductions !== undefined ? Number(customOverrides.statutoryDeductions) : Math.round((salary ? Number(salary.pf || 0) + Number(salary.professionalTax || 0) : 0) * (workedDaysInFinalMonth / standardWorkingDays));
    const otherDeductions = customOverrides.otherDeductions !== undefined ? Number(customOverrides.otherDeductions) : 0;

    // Totals
    const grossEarnings = Math.round(
      (finalSalaryPayable + overtimePay + leaveEncashmentAmount + pendingReimbursements + gratuityOrBonus + otherEarnings) * 100
    ) / 100;

    const totalDeductions = Math.round(
      (lopDeduction + noticeShortfallDeduction + assetRecoveryAmount + loanOrAdvanceRecovery + statutoryDeductions + otherDeductions) * 100
    ) / 100;

    const netPayable = Math.round((grossEarnings - totalDeductions) * 100) / 100;

    // Upsert FinalSettlement Record
    const settlement = await prisma.finalSettlement.upsert({
      where: { exitId },
      create: {
        organizationId,
        exitId,
        employeeId: employee.id,
        workedDaysInFinalMonth,
        finalSalaryPayable,
        overtimePay,
        leaveEncashmentDays,
        leaveEncashmentAmount,
        pendingReimbursements,
        gratuityOrBonus,
        otherEarnings,
        lopDays,
        lopDeduction,
        noticeShortfallDays,
        noticeShortfallDeduction,
        assetRecoveryAmount,
        loanOrAdvanceRecovery,
        statutoryDeductions,
        otherDeductions,
        grossEarnings,
        totalDeductions,
        netPayable,
        status: "DRAFT",
      },
      update: {
        workedDaysInFinalMonth,
        finalSalaryPayable,
        overtimePay,
        leaveEncashmentDays,
        leaveEncashmentAmount,
        pendingReimbursements,
        gratuityOrBonus,
        otherEarnings,
        lopDays,
        lopDeduction,
        noticeShortfallDays,
        noticeShortfallDeduction,
        assetRecoveryAmount,
        loanOrAdvanceRecovery,
        statutoryDeductions,
        otherDeductions,
        grossEarnings,
        totalDeductions,
        netPayable,
      },
    });

    // Advance exit status to SETTLEMENT_CALCULATED
    if (exit.status !== "TERMINATED" && exit.status !== "SETTLED") {
      await prisma.employeeExit.update({
        where: { id: exitId },
        data: { status: "SETTLEMENT_CALCULATED" },
      });
    }

    return settlement;
  }

  /**
   * 8. Disburse Settlement and Terminate Employee
   */
  async disburseSettlementAndTerminate(organizationId, exitId, payload, adminUser) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
      include: {
        employee: { include: { user: true } },
        finalSettlement: true,
      },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    if (!exit.finalSettlement) {
      const error = new Error("Final settlement has not been calculated yet");
      error.statusCode = 400;
      throw error;
    }

    const { paymentReference, remarks } = payload;
    const adminName = adminUser.employee
      ? `${adminUser.employee.firstName} ${adminUser.employee.lastName || ""}`.trim()
      : adminUser.email;

    // 1. Mark Settlement as DISBURSED
    const updatedSettlement = await prisma.finalSettlement.update({
      where: { exitId },
      data: {
        status: "DISBURSED",
        approvedBy: adminName,
        approvedAt: new Date(),
        disbursedAt: new Date(),
        paymentReference: paymentReference ? paymentReference.trim() : `WP-FF-${Date.now().toString().slice(-6)}`,
        remarks: remarks ? remarks.trim() : null,
      },
    });

    // 2. Mark Exit as TERMINATED
    const updatedExit = await prisma.employeeExit.update({
      where: { id: exitId },
      data: { status: "TERMINATED" },
    });

    // 3. Mark Employee status as TERMINATED
    await prisma.employee.update({
      where: { id: exit.employeeId },
      data: { status: "TERMINATED" },
    });

    // 4. Deactivate User Account & Invalidate Tokens
    if (exit.employee?.userId) {
      await prisma.user.update({
        where: { id: exit.employee.userId },
        data: { isActive: false },
      });

      // Clear any refresh tokens
      await prisma.refreshToken.deleteMany({
        where: { userId: exit.employee.userId },
      });

      // Send farewell notification
      try {
        await notificationService.createNotification({
          organizationId,
          userId: exit.employee.userId,
          title: "Full & Final Settlement Disbursed",
          message: `Your Full & Final settlement of ₹${Number(updatedSettlement.netPayable).toLocaleString("en-IN")} has been processed. Relieving and experience letters are now available.`,
          type: "SYSTEM",
        });
      } catch (err) {
        console.warn("Notification error:", err.message);
      }
    }

    return {
      success: true,
      message: "Employee successfully settled and transitioned to TERMINATED status",
      settlement: updatedSettlement,
      exit: updatedExit,
    };
  }

  /**
   * 9. Generate Exit Documentation Data (Full & Final, Relieving Letter, Experience Letter, Clearance Certificate)
   */
  async getExitDocumentData(organizationId, exitId, docType) {
    const exit = await prisma.employeeExit.findFirst({
      where: { id: exitId, organizationId },
      include: {
        organization: true,
        employee: {
          include: {
            department: true,
            branch: true,
            salaryStructure: true,
            user: true,
          },
        },
        clearances: true,
        finalSettlement: true,
      },
    });

    if (!exit) {
      const error = new Error("Exit record not found");
      error.statusCode = 404;
      throw error;
    }

    const { employee, organization, clearances, finalSettlement } = exit;
    const joiningDate = employee.createdAt ? new Date(employee.createdAt) : new Date();
    const exitDate = exit.approvedLastWorkingDate || exit.preferredLastWorkingDate || new Date();

    const formatDateStr = (d) =>
      new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

    // Base document envelope
    const baseData = {
      docType,
      generatedDate: formatDateStr(new Date()),
      organization: {
        name: organization.name,
        email: organization.email || "hr@workpulse.io",
        phone: organization.phone || "+91 80 4000 0000",
        address: "Corporate Towers, High-Tech City, Bengaluru, KA 560100",
      },
      employee: {
        id: employee.id,
        code: employee.employeeCode,
        name: `${employee.firstName} ${employee.lastName || ""}`.trim(),
        email: employee.user?.email || null,
        phone: employee.phone || null,
        designation: employee.user?.role === "MANAGER" ? "Senior Lead / Manager" : "Software Engineer",
        department: employee.department?.name || "Operations",
        branch: employee.branch?.name || "Main HQ",
        joiningDate: formatDateStr(joiningDate),
        lastWorkingDay: formatDateStr(exitDate),
        status: employee.status,
      },
      exit: {
        id: exit.id,
        exitType: exit.exitType,
        status: exit.status,
        resignationDate: formatDateStr(exit.resignationDate),
        reason: exit.reason,
      },
    };

    if (docType === "FF_STATEMENT") {
      baseData.settlement = finalSettlement
        ? {
            ...finalSettlement,
            workedDaysInFinalMonth: Number(finalSettlement.workedDaysInFinalMonth),
            finalSalaryPayable: Number(finalSettlement.finalSalaryPayable),
            overtimePay: Number(finalSettlement.overtimePay),
            leaveEncashmentDays: Number(finalSettlement.leaveEncashmentDays),
            leaveEncashmentAmount: Number(finalSettlement.leaveEncashmentAmount),
            pendingReimbursements: Number(finalSettlement.pendingReimbursements),
            gratuityOrBonus: Number(finalSettlement.gratuityOrBonus),
            otherEarnings: Number(finalSettlement.otherEarnings),
            grossEarnings: Number(finalSettlement.grossEarnings),
            lopDays: Number(finalSettlement.lopDays),
            lopDeduction: Number(finalSettlement.lopDeduction),
            noticeShortfallDays: Number(finalSettlement.noticeShortfallDays),
            noticeShortfallDeduction: Number(finalSettlement.noticeShortfallDeduction),
            assetRecoveryAmount: Number(finalSettlement.assetRecoveryAmount),
            loanOrAdvanceRecovery: Number(finalSettlement.loanOrAdvanceRecovery),
            statutoryDeductions: Number(finalSettlement.statutoryDeductions),
            otherDeductions: Number(finalSettlement.otherDeductions),
            totalDeductions: Number(finalSettlement.totalDeductions),
            netPayable: Number(finalSettlement.netPayable),
          }
        : null;
    }

    if (docType === "CLEARANCE_CERTIFICATE") {
      baseData.clearances = clearances.map((c) => ({
        department: c.department,
        itemName: c.itemName,
        status: c.status,
        clearedBy: c.clearedBy || "Department Lead",
        clearedAt: c.clearedAt ? formatDateStr(c.clearedAt) : "Pending",
        recoveryAmount: Number(c.recoveryAmount),
        remarks: c.remarks || "No dues pending",
      }));
    }

    return baseData;
  }
}

module.exports = new OffboardingService();
