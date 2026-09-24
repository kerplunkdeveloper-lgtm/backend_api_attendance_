const prisma = require("../config/database");

async function createCycle(organizationId, payload) {
  if (!payload.name || !payload.startDate || !payload.endDate) {
    const err = new Error("name, startDate and endDate are required");
    err.statusCode = 400;
    throw err;
  }
  const cycle = await prisma.appraisalCycle.create({
    data: {
      organizationId,
      name: String(payload.name).trim(),
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
      status: "OPEN",
    },
  });
  const employees = await prisma.employee.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (employees.length) {
    await prisma.appraisalReview.createMany({
      data: employees.map((e) => ({
        organizationId,
        cycleId: cycle.id,
        employeeId: e.id,
        status: "DRAFT",
      })),
    });
  }
  return getCycle(organizationId, cycle.id);
}

async function listCycles(organizationId) {
  return prisma.appraisalCycle.findMany({
    where: { organizationId },
    include: { _count: { select: { reviews: true } } },
    orderBy: { createdAt: "desc" },
  });
}

async function getCycle(organizationId, id) {
  const cycle = await prisma.appraisalCycle.findFirst({
    where: { id, organizationId },
    include: {
      reviews: {
        include: {
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        },
      },
    },
  });
  if (!cycle) {
    const err = new Error("Appraisal cycle not found");
    err.statusCode = 404;
    throw err;
  }
  return cycle;
}

async function myReview(organizationId, userId) {
  const emp = await prisma.employee.findFirst({ where: { organizationId, userId } });
  if (!emp) return [];
  return prisma.appraisalReview.findMany({
    where: { organizationId, employeeId: emp.id },
    include: { cycle: true },
    orderBy: { createdAt: "desc" },
  });
}

async function submitSelf(organizationId, userId, reviewId, payload) {
  const emp = await prisma.employee.findFirst({ where: { organizationId, userId } });
  const review = await prisma.appraisalReview.findFirst({
    where: { id: reviewId, organizationId, employeeId: emp?.id },
  });
  if (!review) {
    const err = new Error("Review not found");
    err.statusCode = 404;
    throw err;
  }
  return prisma.appraisalReview.update({
    where: { id: reviewId },
    data: {
      selfScore: payload.selfScore != null ? Number(payload.selfScore) : review.selfScore,
      selfComments: payload.selfComments != null ? String(payload.selfComments) : review.selfComments,
      status: "SELF_SUBMITTED",
    },
    include: { cycle: true },
  });
}

async function submitManager(organizationId, userId, reviewId, payload) {
  const review = await prisma.appraisalReview.findFirst({ where: { id: reviewId, organizationId } });
  if (!review) {
    const err = new Error("Review not found");
    err.statusCode = 404;
    throw err;
  }
  return prisma.appraisalReview.update({
    where: { id: reviewId },
    data: {
      reviewerUserId: userId,
      managerScore: payload.managerScore != null ? Number(payload.managerScore) : review.managerScore,
      managerComments: payload.managerComments != null ? String(payload.managerComments) : review.managerComments,
      status: "COMPLETED",
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, cycle: true },
  });
}

module.exports = { createCycle, listCycles, getCycle, myReview, submitSelf, submitManager };
