const prisma = require("../config/database");
const { assertCanReview, visibleToReviewer } = require("../utils/approvalChain");

const MAX_REASON = 500;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const dateOnly = (value) => {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw fail("Use valid dates in YYYY-MM-DD format.");
  const date = new Date(raw + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime())) throw fail("Use valid dates in YYYY-MM-DD format.");
  return date;
};
const notify = async (organizationId, userIds, title, message) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try { await prisma.notification.createMany({ data: ids.map((userId) => ({ organizationId, userId, title, message, type: "ATTENDANCE" })) }); }
  catch (error) { console.warn("[WorkFromHome] notification failed:", error.message); }
};
const nameOf = (employee) => ((employee?.firstName || "") + " " + (employee?.lastName || "")).trim() || "Employee";

class WorkFromHomeService {
  async createRequest(userId, organizationId, { startDate, endDate, reason } = {}) {
    const start = dateOnly(startDate);
    const end = dateOnly(endDate || startDate);
    if (end < start) throw fail("End date cannot be before start date.");
    const cleanReason = String(reason || "").trim().slice(0, MAX_REASON);
    if (cleanReason.length < 3) throw fail("Please explain why you need to work from home.");

    const employee = await prisma.employee.findFirst({ where: { userId, organizationId, deletedAt: null }, include: { user: { select: { role: true } } } });
    if (!employee) throw fail("Active employee profile not found.", 404);

    const overlap = await prisma.workFromHomeRequest.findFirst({
      where: { organizationId, employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
    });
    if (overlap) throw fail("You already have a pending or approved WFH request covering these dates.", 409);

    const leaveOverlap = await prisma.leaveRequest.findFirst({
      where: { organizationId, employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: end }, endDate: { gte: start } },
      include: { leaveType: { select: { name: true } } },
    });
    if (leaveOverlap) throw fail("These dates overlap your " + (leaveOverlap.leaveType?.name || "leave") + " request.", 409);

    const request = await prisma.workFromHomeRequest.create({
      data: { organizationId, employeeId: employee.id, startDate: start, endDate: end, reason: cleanReason },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    const reviewerRoles = employee.user?.role === "EMPLOYEE" ? ["COMPANY_ADMIN", "MANAGER"] : ["COMPANY_ADMIN"];
    const reviewers = await prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: reviewerRoles }, id: { not: userId } }, select: { id: true } });
    await notify(organizationId, reviewers.map((item) => item.id), "Work-from-home request", nameOf(employee) + " requested WFH from " + String(startDate).slice(0, 10) + " to " + String(endDate || startDate).slice(0, 10) + ".");
    return request;
  }

  async getMyRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return [];
    return prisma.workFromHomeRequest.findMany({ where: { organizationId, employeeId: employee.id }, orderBy: { startDate: "desc" }, take: 100 });
  }

  async getRequests(organizationId, query = {}, reviewerRole = "COMPANY_ADMIN") {
    const { status, page = 1, limit = 50 } = query;
    const where = { organizationId, ...visibleToReviewer(reviewerRole) };
    if (status && status !== "ALL") where.status = status;
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const [records, total] = await Promise.all([
      prisma.workFromHomeRequest.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } } }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], take, skip: (currentPage - 1) * take }),
      prisma.workFromHomeRequest.count({ where }),
    ]);
    return { records, total, page: currentPage, totalPages: Math.ceil(total / take) || 1 };
  }

  async reviewRequest(id, organizationId, reviewerUserId, { status, reviewNote } = {}, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(status)) throw fail("Status must be APPROVED or REJECTED.");
    const request = await prisma.workFromHomeRequest.findFirst({ where: { id, organizationId }, include: { employee: { select: { userId: true, firstName: true, lastName: true, user: { select: { role: true } } } } } });
    if (!request) throw fail("WFH request not found.", 404);
    if (request.status !== "PENDING") throw fail("This request was already " + request.status.toLowerCase() + ".", 409);
    if (request.employee?.userId === reviewerUserId) throw fail("You cannot approve your own WFH request.", 403);
    assertCanReview(request.employee?.user?.role, reviewerRole);
    const updated = await prisma.workFromHomeRequest.update({ where: { id }, data: { status, reviewedBy: reviewerUserId, reviewNote: String(reviewNote || "").trim().slice(0, MAX_REASON) || null, reviewedAt: new Date() } });
    const suffix = updated.reviewNote ? " " + updated.reviewNote : "";
    await notify(organizationId, [request.employee?.userId], status === "APPROVED" ? "Work-from-home approved" : "Work-from-home not approved", status === "APPROVED" ? "Your WFH request was approved. Remember to check in from the Work From Home option." : "Your WFH request was rejected." + suffix);
    return updated;
  }
}
module.exports = new WorkFromHomeService();