const prisma = require("../config/database");

function num(v) {
  return Number(v || 0);
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
  return prisma.loanAdvance.create({
    data: {
      organizationId,
      employeeId: employee.id,
      type: payload.type === "LOAN" ? "LOAN" : "ADVANCE",
      amount,
      monthlyRecovery: num(payload.monthlyRecovery),
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
  return prisma.loanAdvance.update({
    where: { id },
    data: {
      status,
      monthlyRecovery: payload.monthlyRecovery !== undefined ? num(payload.monthlyRecovery) : undefined,
      reviewNote: payload.reviewNote || null,
      reviewedByUserId: reviewerUserId,
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
  });
}

module.exports = { apply, list, review };
