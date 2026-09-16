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

    return {
      ...balance,
      creditedDays: Number(balance.creditedDays),
      usedDays: Number(balance.usedDays),
      availableDays: Math.max(0, Number(balance.creditedDays) - Number(balance.usedDays)),
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
  async redeemCompOff(organizationId, employeeId, { days = 1, reason }) {
    const balance = await prisma.compOffBalance.findUnique({ where: { employeeId } });
    const available = balance ? Math.max(0, Number(balance.creditedDays) - Number(balance.usedDays)) : 0;

    const numDays = Number(days);
    if (numDays > available) {
      const error = new Error(`Insufficient comp-off balance. Available: ${available} day(s), Requested: ${numDays} day(s)`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.compOffBalance.update({
        where: { employeeId },
        data: { usedDays: { increment: numDays } },
      });

      const transaction = await tx.compOffTransaction.create({
        data: {
          compOffBalanceId: updated.id,
          type: "DEBIT",
          days: numDays,
          reason: reason || "Comp-off redeemed",
        },
      });

      return {
        success: true,
        message: `${numDays} comp-off day(s) redeemed successfully`,
        balance: {
          ...updated,
          creditedDays: Number(updated.creditedDays),
          usedDays: Number(updated.usedDays),
          availableDays: Math.max(0, Number(updated.creditedDays) - Number(updated.usedDays)),
        },
        transaction,
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
