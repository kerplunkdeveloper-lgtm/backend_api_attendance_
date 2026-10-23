const prisma = require("../config/database");
const { WORKING_STATUSES } = require("../utils/employeeStatus");

const fail = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  throw err;
};

/** Scores are whole numbers from 1 to 5 (the UI scale). Blank or 0 means "not entered" and keeps the stored value. */
const parseScore = (value, current) => {
  if (value === undefined || value === null || value === "" || Number(value) === 0) return current;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) fail("Score must be a whole number from 1 to 5.");
  return score;
};

async function createCycle(organizationId, payload) {
  if (!payload.name || !payload.startDate || !payload.endDate) {
    fail("name, startDate and endDate are required");
  }
  const start = new Date(payload.startDate);
  const end = new Date(payload.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) fail("Enter valid start and end dates.");
  if (end < start) fail("The cycle cannot end before it starts.");
  const cycle = await prisma.appraisalCycle.create({
    data: {
      organizationId,
      name: String(payload.name).trim(),
      startDate: start,
      endDate: end,
      status: "OPEN",
    },
  });
  const employees = await prisma.employee.findMany({
    where: { organizationId, status: { in: WORKING_STATUSES } },
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
  // A finished review is the record of the appraisal; resubmitting a self-score must not reopen it.
  if (review.status === "COMPLETED") fail("This review is already completed and can no longer be changed.", 409);
  return prisma.appraisalReview.update({
    where: { id: reviewId },
    data: {
      selfScore: parseScore(payload.selfScore, review.selfScore),
      selfComments: payload.selfComments != null ? String(payload.selfComments) : review.selfComments,
      status: "SELF_SUBMITTED",
    },
    include: { cycle: true },
  });
}

async function submitManager(organizationId, userId, reviewId, payload) {
  const review = await prisma.appraisalReview.findFirst({
    where: { id: reviewId, organizationId },
    include: { employee: { select: { userId: true } } },
  });
  if (!review) {
    const err = new Error("Review not found");
    err.statusCode = 404;
    throw err;
  }
  if (review.employee?.userId && review.employee.userId === userId) fail("You cannot score your own appraisal.", 403);
  return prisma.appraisalReview.update({
    where: { id: reviewId },
    data: {
      reviewerUserId: userId,
      managerScore: parseScore(payload.managerScore, review.managerScore),
      managerComments: payload.managerComments != null ? String(payload.managerComments) : review.managerComments,
      status: "COMPLETED",
    },
    include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, cycle: true },
  });
}

module.exports = { createCycle, listCycles, getCycle, myReview, submitSelf, submitManager };
