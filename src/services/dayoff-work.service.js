const prisma = require("../config/database");
const { assertCanReview, visibleToReviewer, ADMIN_ROLES } = require("../utils/approvalChain");
const { parsePagination } = require("../utils/pagination");
const { getDayOff, getOrgDateOnly } = require("./attendance.service");

const REASONS = {
  SHOOT: "Shoot",
  TRAVEL: "Travel",
  CLIENT_VISIT: "Client visit",
  OTHER: "Other company work",
};
const KIND_LABEL = { WEEK_OFF: "weekly off", HOLIDAY: "holiday", COMPANY_LEAVE: "company leave" };
const MAX_NOTE = 300;

const fail = (message, statusCode = 400, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

const dateLabel = (date) =>
  new Date(date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

const notifyMany = async (organizationId, userIds, title, message) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({ organizationId, userId, title, message, type: "ATTENDANCE" })),
    });
  } catch (err) {
    // A failed notification must never undo the request itself.
    console.warn("[DayOffWork] notification failed:", err.message);
  }
};

class DayOffWorkService {
  /**
   * An employee asks to work today, which is a weekly off, holiday or company leave.
   * Asking again after a rejection reopens the same request.
   */
  async createRequest(userId, organizationId, { reasonType, note } = {}) {
    const reason = String(reasonType || "").toUpperCase();
    if (!REASONS[reason]) throw fail(`Choose why you are working: ${Object.values(REASONS).join(", ")}.`);
    const cleanNote = String(note || "").trim().slice(0, MAX_NOTE);
    if (reason === "OTHER" && cleanNote.length < 3) throw fail("Tell us what the work is.");

    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId, deletedAt: null },
      include: { branch: true, shift: true, user: { select: { role: true } } },
    });
    if (!employee) throw fail("Active employee profile not found", 404);

    const dayOff = await getDayOff(organizationId, employee, new Date());
    if (!dayOff) throw fail("Today is a normal working day. You can punch in directly.");
    const date = dayOff.date || (await getOrgDateOnly(organizationId, new Date()));

    const existing = await prisma.dayOffWorkRequest.findFirst({ where: { employeeId: employee.id, date } });
    if (existing?.status === "PENDING") throw fail("Your request is already waiting for approval.", 409);
    if (existing?.status === "APPROVED") throw fail("Your request is already approved. You can punch in.", 409);

    const data = { dayKind: dayOff.kind, reasonType: reason, note: cleanNote || null, status: "PENDING", reviewedBy: null, reviewNote: null, reviewedAt: null };
    const request = existing
      ? await prisma.dayOffWorkRequest.update({ where: { id: existing.id }, data })
      : await prisma.dayOffWorkRequest.create({ data: { organizationId, employeeId: employee.id, date, ...data } });

    // HR and admins review an employee's request; only admins review an HR or admin's own request.
    const reviewerRoles = employee.user?.role === "EMPLOYEE" ? ["COMPANY_ADMIN", "MANAGER"] : ["COMPANY_ADMIN"];
    const reviewers = await prisma.user.findMany({
      where: { organizationId, isActive: true, role: { in: reviewerRoles }, id: { not: userId } },
      select: { id: true },
    });
    const name = `${employee.firstName} ${employee.lastName || ""}`.trim();
    await notifyMany(
      organizationId,
      reviewers.map((u) => u.id),
      "Day-off work request",
      `${name} wants to work on ${dateLabel(date)} (${KIND_LABEL[dayOff.kind]}): ${REASONS[reason]}${cleanNote ? ` - ${cleanNote}` : ""}.`,
    );

    return request;
  }

  async getMyRequests(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return [];
    return prisma.dayOffWorkRequest.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { date: "desc" },
      take: 30,
    });
  }

  /** Requests for review, with a count per status for the filter chips. */
  async getRequests(organizationId, query = {}, reviewerRole = "COMPANY_ADMIN") {
    const { status, page = 1, limit = 50 } = query;
    const visible = { organizationId, ...visibleToReviewer(reviewerRole) };
    const where = { ...visible };
    if (status && status !== "ALL") where.status = status;
    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

    const [records, total, grouped] = await Promise.all([
      prisma.dayOffWorkRequest.findMany({
        where,
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } },
          },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take,
        skip,
      }),
      prisma.dayOffWorkRequest.count({ where }),
      prisma.dayOffWorkRequest.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    ]);

    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;
    return { records, total, page: curPage, totalPages: Math.ceil(total / take) || 1, counts };
  }

  async reviewRequest(requestId, organizationId, reviewerUserId, { status, reviewNote } = {}, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(status)) throw fail("Status must be APPROVED or REJECTED");

    const request = await prisma.dayOffWorkRequest.findFirst({
      where: { id: requestId, organizationId },
      include: { employee: { select: { id: true, userId: true, firstName: true, user: { select: { role: true } } } } },
    });
    if (!request) throw fail("Request not found", 404);
    if (request.status !== "PENDING") throw fail(`This request was already ${request.status.toLowerCase()}.`, 409);
    if (request.employee?.userId && request.employee.userId === reviewerUserId) {
      throw fail("You cannot approve your own request.", 403);
    }
    assertCanReview(request.employee?.user?.role, reviewerRole);

    const updated = await prisma.dayOffWorkRequest.update({
      where: { id: requestId },
      data: { status, reviewedBy: reviewerUserId, reviewNote: String(reviewNote || "").trim().slice(0, MAX_NOTE) || null, reviewedAt: new Date() },
    });

    await notifyMany(
      organizationId,
      [request.employee?.userId],
      status === "APPROVED" ? "Day-off work approved" : "Day-off work not approved",
      status === "APPROVED"
        ? `You can punch in on ${dateLabel(request.date)}. All hours worked will be logged as overtime.`
        : `Your request to work on ${dateLabel(request.date)} was not approved.${updated.reviewNote ? ` ${updated.reviewNote}` : ""}`,
    );
    return updated;
  }
}

module.exports = new DayOffWorkService();
module.exports.REASONS = REASONS;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
