const prisma = require("../config/database");
const { uploadImage, uploadBuffer } = require("../config/cloudinary");

const VALID_CATEGORIES = [
  "TRAVEL",
  "CLIENT_ENTERTAINMENT",
  "FUEL",
  "INTERNET",
  "LEARNING",
  "OTHER",
];

class ExpenseService {
  /**
   * 1. Submit a new Expense Reimbursement Claim
   */
  async createExpenseClaim(organizationId, employeeId, data) {
    const { category, amount, date, title, description, receiptUrl, receiptData } = data;

    if (!category || !amount || !title) {
      const error = new Error("Category, amount, and title are required fields.");
      error.statusCode = 400;
      throw error;
    }

    const cleanCategory = String(category).toUpperCase();
    if (!VALID_CATEGORIES.includes(cleanCategory)) {
      const error = new Error(`Invalid category. Allowed: ${VALID_CATEGORIES.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      const error = new Error("Amount must be a positive number.");
      error.statusCode = 400;
      throw error;
    }

    // Verify employee belongs to this organization
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, organizationId },
    });
    if (!employee) {
      const error = new Error("Employee not found in this organization.");
      error.statusCode = 404;
      throw error;
    }

    // Upload receipt to Cloudinary if base64 data URI provided
    let finalReceiptUrl = receiptUrl || null;
    let receiptPublicId = null;

    const sourceData = receiptData || receiptUrl;
    if (typeof sourceData === "string" && sourceData.startsWith("data:")) {
      try {
        const uploadRes = await uploadImage(sourceData, {
          folder: `workpulse/expenses/${organizationId}`,
          resource_type: "auto",
        });
        if (uploadRes && uploadRes.secure_url) {
          finalReceiptUrl = uploadRes.secure_url;
          receiptPublicId = uploadRes.public_id;
        }
      } catch (cloudErr) {
        console.warn("Cloudinary upload fallback for expense receipt:", cloudErr.message);
        finalReceiptUrl = sourceData; // fallback
      }
    }

    const claimDate = date ? new Date(date) : new Date();

    const claim = await prisma.expenseClaim.create({
      data: {
        organizationId,
        employeeId,
        category: cleanCategory,
        amount: numAmount,
        date: claimDate,
        title: title.trim(),
        description: description ? description.trim() : null,
        receiptUrl: finalReceiptUrl,
        receiptPublicId,
        status: "PENDING",
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
      },
    });

    return claim;
  }

  /**
   * 2. Get Organization-Wide Expense Claims (HR / Manager View)
   */
  async getOrganizationExpenses(organizationId, filters = {}) {
    const { status, category, employeeId, startDate, endDate, search } = filters;

    const where = { organizationId };

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = category;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        {
          employee: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    return await prisma.expenseClaim.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
        payslip: {
          select: {
            id: true,
            month: true,
            year: true,
            status: true,
          },
        },
      },
      orderBy: { date: "desc" },
    });
  }

  /**
   * 3. Get Employee's Own Claims (Self-Service View)
   */
  async getEmployeeExpenses(organizationId, employeeId, filters = {}) {
    const { status, category } = filters;
    const where = { organizationId, employeeId };

    if (status) where.status = status;
    if (category) where.category = category;

    return await prisma.expenseClaim.findMany({
      where,
      include: {
        payslip: {
          select: {
            id: true,
            month: true,
            year: true,
            status: true,
          },
        },
      },
      orderBy: { date: "desc" },
    });
  }

  /**
   * 4. Review Claim (HR/Manager: Approve or Reject)
   */
  async reviewExpenseClaim(organizationId, claimId, reviewerUserId, reviewData) {
    const { status, reviewNote } = reviewData;

    if (!["APPROVED", "REJECTED"].includes(status)) {
      const error = new Error("Status must be either APPROVED or REJECTED.");
      error.statusCode = 400;
      throw error;
    }

    const claim = await prisma.expenseClaim.findFirst({
      where: { id: claimId, organizationId },
      include: {
        employee: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!claim) {
      const error = new Error("Expense claim not found.");
      error.statusCode = 404;
      throw error;
    }

    if (claim.status === "PAID") {
      const error = new Error("Cannot modify an expense claim that has already been paid/bundled into payroll.");
      error.statusCode = 400;
      throw error;
    }

    const updatedClaim = await prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status,
        reviewedBy: reviewerUserId,
        reviewNote: reviewNote ? reviewNote.trim() : null,
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
    });

    // Create Notification for the employee
    if (claim.employee?.userId) {
      try {
        await prisma.notification.create({
          data: {
            organizationId,
            userId: claim.employee.userId,
            title: `Expense Claim ${status}: ${claim.title}`,
            message: `Your claim of ₹${Number(claim.amount).toLocaleString("en-IN")} has been ${status.toLowerCase()} by HR/Manager.${reviewNote ? ` Note: "${reviewNote}"` : ""}`,
            type: "EXPENSE",
          },
        });
      } catch (notifyErr) {
        console.warn("Failed to create expense review notification:", notifyErr.message);
      }
    }

    return updatedClaim;
  }

  /**
   * 5. Delete a Pending Claim (Employee can cancel before review)
   */
  async deleteExpenseClaim(organizationId, employeeId, claimId) {
    const claim = await prisma.expenseClaim.findFirst({
      where: { id: claimId, organizationId, employeeId },
    });

    if (!claim) {
      const error = new Error("Expense claim not found.");
      error.statusCode = 404;
      throw error;
    }

    if (claim.status !== "PENDING") {
      const error = new Error("Only pending claims can be cancelled.");
      error.statusCode = 400;
      throw error;
    }

    await prisma.expenseClaim.delete({
      where: { id: claimId },
    });

    return { success: true, message: "Claim cancelled successfully" };
  }

  /**
   * 6. Summary KPIs for Dashboard
   */
  async getExpenseSummary(organizationId, filters = {}) {
    const claims = await prisma.expenseClaim.findMany({
      where: { organizationId },
      select: {
        id: true,
        category: true,
        amount: true,
        status: true,
        date: true,
      },
    });

    let totalAmount = 0;
    let pendingAmount = 0;
    let pendingCount = 0;
    let approvedAmount = 0;
    let approvedCount = 0;
    let paidAmount = 0;
    let paidCount = 0;
    let rejectedCount = 0;

    const categoryBreakdown = {};
    for (const cat of VALID_CATEGORIES) {
      categoryBreakdown[cat] = { count: 0, amount: 0 };
    }

    for (const c of claims) {
      const amt = Number(c.amount) || 0;
      totalAmount += amt;

      if (categoryBreakdown[c.category]) {
        categoryBreakdown[c.category].count += 1;
        categoryBreakdown[c.category].amount += amt;
      }

      if (c.status === "PENDING") {
        pendingCount++;
        pendingAmount += amt;
      } else if (c.status === "APPROVED") {
        approvedCount++;
        approvedAmount += amt;
      } else if (c.status === "PAID") {
        paidCount++;
        paidAmount += amt;
      } else if (c.status === "REJECTED") {
        rejectedCount++;
      }
    }

    return {
      totalClaimsCount: claims.length,
      totalAmount,
      pendingCount,
      pendingAmount,
      approvedCount,
      approvedAmount,
      paidCount,
      paidAmount,
      rejectedCount,
      categoryBreakdown,
    };
  }

  /**
   * 7. Get approved claims not yet bundled into any payslip for an employee
   */
  async getApprovedUnbundledReimbursements(organizationId, employeeId) {
    return await prisma.expenseClaim.findMany({
      where: {
        organizationId,
        employeeId,
        status: "APPROVED",
        payslipId: null,
      },
      orderBy: { date: "asc" },
    });
  }
}

module.exports = new ExpenseService();
