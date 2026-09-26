const prisma = require("../config/database");

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("Amount must be a finite non-negative number");
    err.statusCode = 400;
    throw err;
  }
  return n;
}

async function apply(organizationId, user, payload) {
  const employee =
    user.role === "EMPLOYEE"
      ? await prisma.employee.findFirst({ where: { organizationId, userId: user.id } })
      : await prisma.employee.findFirst({ where: { id: payload.employeeId, organizationId } });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }
  const amount = num(payload.amount);
  if (amount <= 0) {
    const err = new Error("Amount must be greater than 0");
    err.statusCode = 400;
    throw err;
  }
  const monthlyRecovery = payload.monthlyRecovery === undefined ? 0 : num(payload.monthlyRecovery);
  if (monthlyRecovery > amount) {
    const err = new Error("Monthly recovery cannot exceed the loan amount");
    err.statusCode = 400;
    throw err;
  }
  return prisma.loanAdvance.create({
    data: {
      organizationId,
      employeeId: employee.id,
      type: payload.type === "LOAN" ? "LOAN" : "ADVANCE",
      amount,
      monthlyRecovery,
      outstanding: amount,
      reason: payload.reason ? String(payload.reason).trim() : null,
      status: "PENDING",
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
  });
}

async function list(organizationId, user) {
  const where = { organizationId };
  if (user.role === "EMPLOYEE") {
    const emp = await prisma.employee.findFirst({ where: { organizationId, userId: user.id } });
    where.employeeId = emp?.id || "__none__";
  }
  return prisma.loanAdvance.findMany({
    where,
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    orderBy: { createdAt: "desc" },
  });
}

async function review(organizationId, id, payload, reviewerUserId) {
  const status = String(payload.status || "").toUpperCase();
  if (!["APPROVED", "REJECTED", "CLOSED"].includes(status)) {
    const err = new Error("status must be APPROVED, REJECTED or CLOSED");
    err.statusCode = 400;
    throw err;
  }
  const existing = await prisma.loanAdvance.findFirst({ where: { id, organizationId } });
  if (!existing) {
    const err = new Error("Loan / advance not found");
    err.statusCode = 404;
    throw err;
  }
  if (status === "CLOSED" && existing.status !== "APPROVED") {
    const err = new Error("Only an approved loan can be closed");
    err.statusCode = 400;
    throw err;
  }
  if (["APPROVED", "REJECTED"].includes(status) && existing.status !== "PENDING") {
    const err = new Error(`Loan has already been ${existing.status.toLowerCase()}`);
    err.statusCode = 400;
    throw err;
  }
  const monthlyRecovery =
    payload.monthlyRecovery !== undefined ? num(payload.monthlyRecovery) : undefined;
  if (monthlyRecovery !== undefined && monthlyRecovery > Number(existing.amount)) {
    const err = new Error("Monthly recovery cannot exceed the loan amount");
    err.statusCode = 400;
    throw err;
  }
  return prisma.loanAdvance.update({
    where: { id },
    data: {
      status,
      monthlyRecovery,
      reviewNote: payload.reviewNote || null,
      reviewedByUserId: reviewerUserId,
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
  });
}

async function outstandingForEmployee(organizationId, employeeId, client = prisma) {
  const rows = await client.loanAdvance.findMany({
    where: { organizationId, employeeId, status: "APPROVED" },
  });
  return rows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0);
}

/**
 * Preview or apply monthly payroll recovery. When `commit` is true, writes a
 * repayment ledger row and decrements outstanding inside the given transaction.
 */
async function recoverForPayroll({ organizationId, employeeId, month, year, payslipId, commit, tx }) {
  const client = tx || prisma;
  if (!client.loanAdvance?.findMany) return { total: 0, recoveries: [] };
  const loans = await client.loanAdvance.findMany({
    where: {
      organizationId,
      employeeId,
      status: "APPROVED",
      outstanding: { gt: 0 },
    },
  });

  let total = 0;
  const recoveries = [];

  for (const loan of loans) {
    const planned = Math.min(Number(loan.monthlyRecovery || 0), Number(loan.outstanding || 0));
    if (planned <= 0) continue;

    let amount = planned;
    if (client.loanRepayment) {
      const existing = await client.loanRepayment.findFirst({
        where: { loanId: loan.id, year, month, source: "PAYROLL" },
      });
      if (existing) {
        amount = Number(existing.amount);
        total += amount;
        recoveries.push({ loanId: loan.id, amount, alreadyPosted: true });
        continue;
      }
    }

    if (commit) {
      if (client.loanRepayment) {
        await client.loanRepayment.create({
          data: {
            organizationId,
            loanId: loan.id,
            employeeId,
            amount,
            year,
            month,
            source: "PAYROLL",
            payslipId: payslipId || null,
          },
        });
      }
      const nextOutstanding = Math.max(0, Number(loan.outstanding) - amount);
      await client.loanAdvance.update({
        where: { id: loan.id },
        data: {
          outstanding: nextOutstanding,
          status: nextOutstanding <= 0 ? "CLOSED" : "APPROVED",
        },
      });
    }

    total += amount;
    recoveries.push({ loanId: loan.id, amount, alreadyPosted: false });
  }

  return { total, recoveries };
}

module.exports = { apply, list, review, outstandingForEmployee, recoverForPayroll };
