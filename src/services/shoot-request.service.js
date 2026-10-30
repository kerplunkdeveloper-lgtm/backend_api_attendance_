const prisma = require("../config/database");
const { visibleToReviewer } = require("../utils/approvalChain");
const notificationService = require("./notification.service");
const SHOOT_REVIEWER_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];
const assertShootReviewer = (role) => { if (!SHOOT_REVIEWER_ROLES.includes(role)) throw fail("Only HR, managers or admins can review shoot requests.", 403); };
const { parsePagination } = require("../utils/pagination");
const { DEFAULT_TIMEZONE, getLocalDateOnly } = require("../utils/datetime");

const MAX = 300;
const fail = (message, statusCode = 400, code) => { const e = new Error(message); e.statusCode = statusCode; if (code) e.code = code; return e; };
const clean = (value, max = MAX) => String(value || "").trim().slice(0, max);

const getShootDate = async (organizationId, value) => { const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }); return getLocalDateOnly(value, org?.timezone || DEFAULT_TIMEZONE); };
const dateLabel = (date) => new Date(date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const notify = async (organizationId, userIds, title, message, type = "ATTENDANCE") => { const ids = [...new Set((userIds || []).filter(Boolean))]; if (!ids.length) return; try { const result = await prisma.notification.createMany({ data: ids.map((userId) => ({ organizationId, userId, title, message, type })) }); if (type !== "APPROVAL") return; } catch (err) { console.warn("[ShootRequest] notification failed:", err.message); } };
class ShootRequestService {
  async create(userId, organizationId, body = {}) {
    const date = await getShootDate(organizationId, new Date(body.date));
    if (!body.date || Number.isNaN(date.getTime())) throw fail("A valid shoot date is required.");
    const shootName = clean(body.shootName, 120), location = clean(body.location, 180), note = clean(body.note);
    const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.startTime || "")) ? String(body.startTime) : "00:00";
    const endTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.endTime || "")) ? String(body.endTime) : "23:59";
    if (!shootName || !location) throw fail("Shoot name and location are required.");
    const requester = await prisma.employee.findFirst({ where: { userId, organizationId, deletedAt: null }, include: { user: { select: { role: true } } } });
    if (!requester) throw fail("Active employee profile not found.", 404);
    const requestedIds = Array.isArray(body.employeeIds) ? [...new Set(body.employeeIds.map(String).filter(Boolean))] : [requester.id];
    if (!requestedIds.length) throw fail("Select at least one employee for this shoot.");
    if (!requestedIds.includes(requester.id)) requestedIds.unshift(requester.id);
    const employees = await prisma.employee.findMany({ where: { id: { in: requestedIds }, organizationId, deletedAt: null, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { role: true } } } });
    if (employees.length !== requestedIds.length) throw fail("One or more selected employees are not active in this organization.", 400);
    const existing = await prisma.shootRequest.findUnique({ where: { employeeId_date: { employeeId: requester.id, date } } });
    if (existing?.status === "PENDING") throw fail("A shoot request for this date is already pending.", 409);
    if (existing?.status === "APPROVED") throw fail("A shoot request for this date is already approved.", 409);
    const data = { organizationId, employeeId: requester.id, date, shootName, location, startTime, endTime, note: note || null, status: "PENDING", reviewedBy: null, reviewNote: null, reviewedAt: null, cancellationRequested: false, cancellationRequestedBy: null, cancellationRequestedAt: null, cancellationReviewNote: null };
    const request = await prisma.$transaction(async (tx) => {
      const row = existing ? await tx.shootRequest.update({ where: { id: existing.id }, data }) : await tx.shootRequest.create({ data });
      await tx.shootRequestParticipant.deleteMany({ where: { shootRequestId: row.id } });
      await tx.shootRequestParticipant.createMany({ data: requestedIds.map((employeeId) => ({ shootRequestId: row.id, employeeId })) });
      return tx.shootRequest.findUnique({ where: { id: row.id }, include: { participants: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } } } });
    });
    await notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: requester.id,
      title: "Shoot approval required",
      summary: `requested ${shootName} on ${dateLabel(date)} at ${location}. Open Approvals to review it.`,
      type: "APPROVAL",
    });
    return request;
  }

  async participants(organizationId) {
    return prisma.employee.findMany({
      where: { organizationId, deletedAt: null, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    });
  }

  async mine(userId, organizationId) {
    const employee = await prisma.employee.findFirst({ where: { userId, organizationId } });
    if (!employee) return [];
    return prisma.shootRequest.findMany({ where: { organizationId, participants: { some: { employeeId: employee.id } } }, include: { participants: { include: { employee: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { date: "desc" }, take: 50 });
  }

  async list(organizationId, query = {}, reviewerRole = "COMPANY_ADMIN") {
    const visible = { organizationId, ...(SHOOT_REVIEWER_ROLES.includes(reviewerRole) ? {} : visibleToReviewer(reviewerRole)) }, where = query.status === "CANCELLATION_PENDING" ? { ...visible, status: "APPROVED", cancellationRequested: true } : { ...visible };
    if (query.status && !["ALL", "CANCELLATION_PENDING"].includes(query.status)) where.status = query.status;
    const { limit, skip, page } = parsePagination(query, { defaultLimit: 50 });
    const [records, total, grouped] = await Promise.all([
      prisma.shootRequest.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } } }, participants: { include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } } } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: limit, skip }),
      prisma.shootRequest.count({ where }), prisma.shootRequest.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    ]);
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 }; grouped.forEach((x) => { counts[x.status] = x._count._all; });
    return { records, total, page, totalPages: Math.ceil(total / limit) || 1, counts };
  }

  async review(id, organizationId, reviewerUserId, body = {}, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(body.status)) throw fail("Status must be APPROVED or REJECTED.");
    const request = await prisma.shootRequest.findFirst({ where: { id, organizationId }, include: { employee: { select: { userId: true, user: { select: { role: true } } } }, participants: { include: { employee: { select: { userId: true } } } } } });
    if (!request) throw fail("Shoot request not found.", 404);
    if (request.status !== "PENDING") throw fail(`This request was already ${request.status.toLowerCase()}.`, 409);
    if (request.employee?.userId === reviewerUserId) throw fail("You cannot approve your own request.", 403);
    assertShootReviewer(reviewerRole);
    const updated = await prisma.shootRequest.update({ where: { id }, data: { status: body.status, reviewedBy: reviewerUserId, reviewNote: clean(body.reviewNote), reviewedAt: new Date() } });
    const participantUserIds = request.participants.map((p) => p.employee?.userId);
    await notify(organizationId, participantUserIds, body.status === "APPROVED" ? "Shoot request approved" : "Shoot request rejected", body.status === "APPROVED" ? `Your shoot request is approved for ${dateLabel(request.date)}. Select Shoot when punching in on that date.` : `Your shoot request was rejected.${updated.reviewNote ? ` ${updated.reviewNote}` : ""}`);
    return updated;
  }

  async cancel(id, organizationId, userId, role = "EMPLOYEE") {
    const request = await prisma.shootRequest.findFirst({ where: { id, organizationId }, include: { employee: { select: { userId: true } }, participants: { include: { employee: { select: { userId: true } } } } } });
    if (!request) throw fail("Shoot request not found.", 404);
    if (!["PENDING", "APPROVED"].includes(request.status)) throw fail(`This request was already ${request.status.toLowerCase()}.`, 409);
    const isReviewer = SHOOT_REVIEWER_ROLES.includes(role);
    if (request.status === "PENDING") {
      if (request.employee?.userId !== userId && !isReviewer) throw fail("Only the requester or an admin can cancel this request.", 403);
      const updated = await prisma.shootRequest.update({ where: { id }, data: { status: "CANCELLED", reviewedBy: userId, reviewNote: "Cancelled before approval", reviewedAt: new Date() } });
      await notify(organizationId, request.participants.map((p) => p.employee?.userId), "Shoot request cancelled", `The shoot request for ${dateLabel(request.date)} was cancelled.`);
      return updated;
    }
    if (isReviewer) throw fail("Use the cancellation review action for an approved shoot.", 400);
    if (request.employee?.userId !== userId) throw fail("Only the requester can request cancellation.", 403);
    if (request.cancellationRequested) throw fail("Cancellation is already waiting for admin approval.", 409);
    const updated = await prisma.shootRequest.update({ where: { id }, data: { cancellationRequested: true, cancellationRequestedBy: userId, cancellationRequestedAt: new Date(), cancellationReviewNote: null } });
    const reviewers = await prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: ["COMPANY_ADMIN", "MANAGER", "HR"] } }, select: { id: true } });
    await notify(organizationId, reviewers.map((u) => u.id), "Shoot cancellation request", `An employee requested cancellation for ${dateLabel(request.date)} (${request.shootName}). Please review it.`);
    return updated;
  }

  async reviewCancellation(id, organizationId, reviewerUserId, body = {}, reviewerRole = "COMPANY_ADMIN") {
    if (!["APPROVED", "REJECTED"].includes(body.status)) throw fail("Cancellation status must be APPROVED or REJECTED.");
    const request = await prisma.shootRequest.findFirst({ where: { id, organizationId }, include: { employee: { select: { userId: true, user: { select: { role: true } } } }, participants: { include: { employee: { select: { userId: true } } } } } });
    if (!request || request.status !== "APPROVED" || !request.cancellationRequested) throw fail("Cancellation request not found.", 404);
    if (request.employee?.userId === reviewerUserId) throw fail("You cannot review your own cancellation request.", 403);
    assertShootReviewer(reviewerRole);
    const approved = body.status === "APPROVED";
    const updated = await prisma.shootRequest.update({ where: { id }, data: approved ? { status: "CANCELLED", reviewedBy: reviewerUserId, reviewNote: clean(body.reviewNote) || "Cancellation approved", reviewedAt: new Date(), cancellationRequested: false, cancellationReviewNote: clean(body.reviewNote) } : { cancellationRequested: false, cancellationReviewNote: clean(body.reviewNote) } });
    await notify(organizationId, request.participants.map((p) => p.employee?.userId), approved ? "Shoot cancellation approved" : "Shoot cancellation rejected", approved ? `The shoot request for ${dateLabel(request.date)} was cancelled.` : `Your shoot cancellation request was rejected.${body.reviewNote ? ` ${body.reviewNote}` : ""}`);
    return updated;
  }
  async getApprovedForDate(employeeId, organizationId, date) {
    return prisma.shootRequest.findFirst({ where: { organizationId, status: "APPROVED", date, participants: { some: { employeeId } } }, select: { id: true, shootName: true, location: true, startTime: true, endTime: true } });
  }
}
module.exports = new ShootRequestService();
