const prisma = require("../config/database");

class CompOffService {
  /**
   * Get or create comp-off balance for an employee
   */
  async getOrCreateBalance(employeeId, organizationId) {
    let balance = await prisma.compOffBalance.findUnique({
      where: { employeeId },
      include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } },
    });

    if (!balance) {
      balance = await prisma.compOffBalance.create({
        data: { organizationId, employeeId, creditedDays: 0, usedDays: 0 },
        include: { transactions: true },
      });
    }

    const pending = await prisma.compOffTransaction.aggregate({
      where: { compOffBalanceId: balance.id, type: "PENDING_DEBIT" },
      _sum: { days: true },
    });
    const availableDays = Math.max(
      0,
      Number(balance.creditedDays) - Number(balance.usedDays) - Number(pending._sum.days || 0)
    );

    return {
      ...balance,
      creditedDays: Number(balance.creditedDays),
      usedDays: Number(balance.usedDays),
      availableDays,
      // Aliases the web and mobile clients read.
      balanceDays: availableDays,
      balance: availableDays,
    };
  }

  /**
   * Full paginated transaction ledger for an employee.
   * The /history route previously returned the balance object instead.
   */
  async getTransactionHistory(employeeId, organizationId, { page = 1, limit = 50 } = {}) {
    const balance = await this.getOrCreateBalance(employeeId, organizationId);

    const take = parseInt(limit, 10) || 50;
    const skip = ((parseInt(page, 10) || 1) - 1) * take;

    const [records, total] = await Promise.all([
      prisma.compOffTransaction.findMany({
        where: { compOffBalanceId: balance.id },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.compOffTransaction.count({ where: { compOffBalanceId: balance.id } }),
    ]);

    return {
      records: records.map((t) => ({ ...t, days: Number(t.days) })),
      total,
      page: parseInt(page, 10) || 1,
      totalPages: Math.ceil(total / take) || 1,
      availableDays: balance.availableDays,
    };
  }

  /**
   * Credit comp-off days to an employee (admin/manager action)
   */
  async creditCompOff(organizationId, employeeId, { days = 1, reason, referenceDate, createdBy }) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) {
      const error = new Error("Employee not found in this organization");
      error.statusCode = 404;
      throw error;
    }

    const numDays = Number(days);
    if (isNaN(numDays) || numDays <= 0) {
      const error = new Error("Days must be a positive number");
      error.statusCode = 400;
      throw error;
    }

    return await prisma.$transaction(async (tx) => {
      const balance = await tx.compOffBalance.upsert({
        where: { employeeId },
        update: { creditedDays: { increment: numDays } },
        create: { organizationId, employeeId, creditedDays: numDays, usedDays: 0 },
      });

      const transaction = await tx.compOffTransaction.create({
        data: {
          compOffBalanceId: balance.id,
          type: "CREDIT",
          days: numDays,
          reason: reason || "Manual credit by admin",
          referenceDate: referenceDate ? new Date(referenceDate) : null,
          createdBy: createdBy || null,
        },
      });

      return {
        success: true,
        message: `${numDays} comp-off day(s) credited to ${employee.firstName} ${employee.lastName || ""}`.trim(),
        balance: {
          ...balance,
          creditedDays: Number(balance.creditedDays),
          usedDays: Number(balance.usedDays),
          availableDays: Math.max(0, Number(balance.creditedDays) - Number(balance.usedDays)),
        },
        transaction,
      };
    });
  }

  /**
   * Redeem (debit) comp-off days (employee action)
   */
  async redeemCompOff(organizationId, employeeId, { days = 1, reason, requestedDate }) {
    const numDays = Number(days);
    if (!Number.isFinite(numDays) || numDays <= 0) {
      const error = new Error("Days must be a positive number");
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

    // The client sends the day the employee intends to take off. It used to be
    // discarded, so the balance dropped but the person was still marked absent.
    const startDate = requestedDate ? new Date(requestedDate) : new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    if (Number.isNaN(startDate.getTime())) {
      const error = new Error("requestedDate is not a valid date");
      error.statusCode = 400;
      throw error;
    }

    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + Math.ceil(numDays) - 1);

    return await prisma.$transaction(async (tx) => {
      const current = await tx.compOffBalance.upsert({
        where: { employeeId },
        update: {},
        create: { organizationId, employeeId, creditedDays: 0, usedDays: 0 },
      });

      const pending = await tx.compOffTransaction.aggregate({
        where: { compOffBalanceId: current.id, type: "PENDING_DEBIT" },
        _sum: { days: true },
      });
      const pendingDays = Number(pending._sum.days || 0);
      const available = Math.max(
        0,
        Number(current.creditedDays) - Number(current.usedDays) - pendingDays
      );

      if (numDays > available) {
        const error = new Error(
          `Insufficient comp-off balance. Available: ${available} day(s), Requested: ${numDays} day(s)`
        );
        error.statusCode = 400;
        throw error;
      }

      const transaction = await tx.compOffTransaction.create({
        data: {
          compOffBalanceId: current.id,
          type: "PENDING_DEBIT",
          days: numDays,
          reason: reason || "Comp-off redeem request",
          referenceDate: startDate,
        },
      });

      const availableDays = Math.max(0, available - numDays);

      return {
        success: true,
        message: `${numDays} comp-off day(s) submitted for manager review from ${startDate.toISOString().slice(0, 10)}`,
        status: "PENDING",
        balance: {
          ...current,
          creditedDays: Number(current.creditedDays),
          usedDays: Number(current.usedDays),
          availableDays,
          balanceDays: availableDays,
        },
        transaction,
      };
    });
  }

  async listPendingRedemptions(organizationId) {
    const balances = await prisma.compOffBalance.findMany({
      where: { organizationId },
      select: { id: true },
    });
    const balanceIds = balances.map((b) => b.id);
    if (!balanceIds.length) return [];

    return prisma.compOffTransaction.findMany({
      where: { compOffBalanceId: { in: balanceIds }, type: "PENDING_DEBIT" },
      include: {
        compOffBalance: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, employeeCode: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async reviewRedemption(organizationId, transactionId, reviewerUserId, { status, reviewNote }) {
    const action = String(status || "").toUpperCase();
    if (!["APPROVED", "REJECTED"].includes(action)) {
      const error = new Error("status must be APPROVED or REJECTED");
      error.statusCode = 400;
      throw error;
    }

    const transaction = await prisma.compOffTransaction.findFirst({
      where: { id: transactionId, type: "PENDING_DEBIT" },
      include: {
        compOffBalance: {
          include: {
            employee: true,
          },
        },
      },
    });

    if (!transaction || transaction.compOffBalance.organizationId !== organizationId) {
      const error = new Error("Pending comp-off request not found");
      error.statusCode = 404;
      throw error;
    }

    const employee = transaction.compOffBalance.employee;
    const numDays = Number(transaction.days);
    const startDate = transaction.referenceDate
      ? new Date(transaction.referenceDate)
      : new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + Math.ceil(numDays) - 1);

    if (action === "REJECTED") {
      const updated = await prisma.compOffTransaction.update({
        where: { id: transaction.id },
        data: {
          type: "REJECTED",
          reason: reviewNote
            ? `${transaction.reason || "Comp-off"} — rejected: ${reviewNote}`
            : transaction.reason,
          createdBy: reviewerUserId,
        },
      });
      return { success: true, message: "Comp-off request rejected", transaction: updated };
    }

    return await prisma.$transaction(async (tx) => {
      const current = await tx.compOffBalance.findUnique({
        where: { id: transaction.compOffBalanceId },
      });
      const available = Math.max(0, Number(current.creditedDays) - Number(current.usedDays));
      if (numDays > available) {
        const error = new Error(
          `Insufficient comp-off balance at approval time. Available: ${available}`
        );
        error.statusCode = 400;
        throw error;
      }

      const updatedBalance = await tx.compOffBalance.update({
        where: { id: current.id },
        data: { usedDays: { increment: numDays } },
      });

      const updatedTxn = await tx.compOffTransaction.update({
        where: { id: transaction.id },
        data: {
          type: "DEBIT",
          reason: reviewNote
            ? `${transaction.reason || "Comp-off"} — ${reviewNote}`
            : transaction.reason,
          createdBy: reviewerUserId,
        },
      });

      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        const dateOnly = new Date(cursor);
        const existing = await tx.attendance.findUnique({
          where: { employeeId_date: { employeeId: employee.id, date: dateOnly } },
          select: { id: true, checkIn: true },
        });

        if (!existing?.checkIn) {
          await tx.attendance.upsert({
            where: { employeeId_date: { employeeId: employee.id, date: dateOnly } },
            update: { status: "ON_LEAVE" },
            create: {
              organizationId,
              employeeId: employee.id,
              branchId: employee.branchId || null,
              shiftId: employee.shiftId || null,
              date: dateOnly,
              status: "ON_LEAVE",
              workingMinutes: 0,
            },
          });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      const availableDays = Math.max(
        0,
        Number(updatedBalance.creditedDays) - Number(updatedBalance.usedDays)
      );

      return {
        success: true,
        message: `${numDays} comp-off day(s) approved`,
        transaction: updatedTxn,
        balance: {
          ...updatedBalance,
          creditedDays: Number(updatedBalance.creditedDays),
          usedDays: Number(updatedBalance.usedDays),
          availableDays,
          balanceDays: availableDays,
        },
      };
    });
  }

  /**
   * List all comp-off balances for the organization (admin view)
   */
  async getOrganizationBalances(organizationId) {
    const balances = await prisma.compOffBalance.findMany({
      where: { organizationId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
        },
        transactions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    return balances.map((b) => ({
      ...b,
      creditedDays: Number(b.creditedDays),
      usedDays: Number(b.usedDays),
      availableDays: Math.max(0, Number(b.creditedDays) - Number(b.usedDays)),
    }));
  }
}

module.exports = new CompOffService();
