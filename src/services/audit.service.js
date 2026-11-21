const prisma = require("../config/database");
const { parsePagination } = require("../utils/pagination");

const parseDetails = (raw) => {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const ownerFromDetails = (owner) => {
  if (!owner || typeof owner !== "object") return null;
  const id = owner.employeeId || owner.id || null;
  const name = String(owner.name || "").trim();
  if (!id && !name) return null;
  return {
    id,
    employeeId: id,
    name: name || "Unknown employee",
    employeeCode: owner.employeeCode || null,
    branchId: owner.branchId || null,
    branchName: owner.branchName || owner.branch?.name || null,
    branch: owner.branch || (owner.branchName ? { name: owner.branchName } : null),
  };
};

class AuditService {
  /**
   * Log an administrative or sensitive action
   */
  async logAction({ organizationId, userId, action, entity, entityId, details, ipAddress, employeeId, branchId, deviceId, deviceName, eventType, riskLevel, reviewStatus, reviewedBy, reviewNote }) {
    try {
      return await prisma.auditLog.create({
        data: {
          organizationId,
          userId: userId || null,
          action,
          entity,
          entityId: entityId ? String(entityId) : null,
          details: typeof details === "object" ? JSON.stringify(details) : details || null,
          ipAddress: ipAddress || null,
          employeeId: employeeId || null,
          branchId: branchId || null,
          deviceId: deviceId || null,
          deviceName: deviceName || null,
          eventType: eventType || null,
          riskLevel: riskLevel || null,
          reviewStatus: reviewStatus || null,
          reviewedBy: reviewedBy || null,
          reviewNote: reviewNote || null,
        },
      });
    } catch (err) {
      console.error("Audit log failed to record:", err.message);
      return null;
    }
  }

  /**
   * Get audit logs for organization (Admin & Manager)
   */
  async getAuditLogs(organizationId, query = {}) {
    const { action, entity, userId, employeeId, branchId, deviceId, eventType, riskLevel, reviewStatus, search, from, to, page = 1, limit = 50 } = query;
    const where = { organizationId, entity: { not: "PLATFORM" } };

    if (action) where.action = action;
    if (entity && entity !== "PLATFORM") where.entity = entity;
    if (userId) where.userId = userId;
    if (employeeId) where.employeeId = employeeId;
    if (branchId) where.branchId = branchId;
    if (deviceId) where.deviceId = { contains: String(deviceId), mode: "insensitive" };
    if (eventType) where.eventType = eventType;
    if (riskLevel) where.riskLevel = riskLevel;
    if (reviewStatus) where.reviewStatus = reviewStatus;
    if (search) {
      where.OR = [
        { deviceName: { contains: String(search), mode: "insensitive" } },
        { deviceId: { contains: String(search), mode: "insensitive" } },
        { details: { contains: String(search), mode: "insensitive" } },
      ];
    }
    // Dates are inclusive of the whole "to" day.
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
      where.createdAt = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) where.createdAt.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) where.createdAt.lt = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

    const pendingWhere = { ...where, reviewStatus: "PENDING" };
    const highRiskWhere = { ...where, riskLevel: "HIGH" };
    const flaggedWhere = { ...where, action: "FLAGGED" };
    const [logs, total, pendingCount, highRiskCount, flaggedCount] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.count({ where: pendingWhere }),
      prisma.auditLog.count({ where: highRiskWhere }),
      prisma.auditLog.count({ where: flaggedWhere }),
    ]);

    // The log stores only the user id; attach who that was so the screen is readable.
    const actorIds = [...new Set(logs.map((log) => log.userId).filter(Boolean))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds }, organizationId },
          select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const actorById = new Map(
      actors.map((u) => [
        u.id,
        { email: u.email, role: u.role, name: `${u.employee?.firstName || ""} ${u.employee?.lastName || ""}`.trim() || u.email },
      ]),
    );
    const employeeIds = [...new Set(logs.map((log) => log.employeeId).filter(Boolean))];
    const employees = employeeIds.length ? await prisma.employee.findMany({
      where: { id: { in: employeeIds }, organizationId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, branch: { select: { id: true, name: true } } },
    }) : [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    // Resolve the earlier employee from the device registry as well as the
    // audit details. This keeps old duplicate-device alerts useful even
    // though previousOwner was not stored by older versions of the service.
    const duplicateDeviceIds = [...new Set(logs
      .filter((log) => ["DUPLICATE_DEVICE", "DEVICE_CONFLICT"].includes(log.eventType) && log.deviceId)
      .map((log) => log.deviceId))];
    const registeredOwners = duplicateDeviceIds.length ? await prisma.employeeDevice.findMany({
      where: { organizationId, deviceId: { in: duplicateDeviceIds } },
      select: {
        deviceId: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
    }) : [];
    const ownersByDevice = new Map();
    for (const row of registeredOwners) {
      const owner = row.employee;
      if (!owner) continue;
      const list = ownersByDevice.get(row.deviceId) || [];
      list.push({
        id: owner.id,
        employeeId: owner.id,
        name: `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || "Unknown employee",
        employeeCode: owner.employeeCode || null,
        branchId: owner.branchId || null,
        branchName: owner.branch?.name || null,
        branch: owner.branch || null,
      });
      ownersByDevice.set(row.deviceId, list);
    }

    const enriched = logs.map((log) => {
      const details = parseDetails(log.details);
      const detailOwners = Array.isArray(details.previousOwners)
        ? details.previousOwners.map(ownerFromDetails).filter(Boolean)
        : [ownerFromDetails(details.previousOwner)].filter(Boolean);
      const registryOwners = (ownersByDevice.get(log.deviceId) || []).filter((owner) => owner.id !== log.employeeId);
      const owners = [...detailOwners, ...registryOwners].filter((owner, index, all) => {
        const key = owner.id || `${owner.name}:${owner.employeeCode || ""}`;
        return all.findIndex((candidate) => (candidate.id || `${candidate.name}:${candidate.employeeCode || ""}`) === key) === index;
      });
      return {
        ...log,
        actor: actorById.get(log.userId) || null,
        employee: employeeById.get(log.employeeId) || null,
        previousOwners: owners,
      };
    });

    return {
      success: true,
      page: curPage,
      limit: take,
      total,
      totalPages: Math.ceil(total / take) || 1,
      summary: {
        total,
        pending: pendingCount,
        highRisk: highRiskCount,
        flagged: flaggedCount,
      },
      logs: enriched,
      data: enriched,
    };
  }

  async reviewLog(organizationId, logId, reviewerId, status, note) {
    const allowed = ["APPROVED", "REJECTED", "FALSE_POSITIVE"];
    if (!allowed.includes(status)) throw Object.assign(new Error("Invalid review status"), { statusCode: 400 });
    const existing = await prisma.auditLog.findFirst({ where: { id: logId, organizationId } });
    if (!existing) throw Object.assign(new Error("Audit event not found"), { statusCode: 404 });
    const reviewedAt = new Date();
    let attendance = null;
    const deviceReview = ["NEW_DEVICE_USE", "DUPLICATE_DEVICE", "DEVICE_CONFLICT"].includes(existing.eventType);
    if (deviceReview && existing.employeeId && ["APPROVED", "REJECTED", "FALSE_POSITIVE"].includes(status)) {
      // Device alerts are created at login/device registration, before the
      // actual punch. Search a small date window so timezone boundaries do
      // not prevent linking the review to that day's attendance row.
      const from = new Date(existing.createdAt);
      from.setUTCDate(from.getUTCDate() - 1);
      from.setUTCHours(0, 0, 0, 0);
      const to = new Date(existing.createdAt);
      to.setUTCDate(to.getUTCDate() + 1);
      to.setUTCHours(23, 59, 59, 999);
      attendance = await prisma.attendance.findFirst({
        where: { organizationId, employeeId: existing.employeeId, date: { gte: from, lte: to } },
        orderBy: [{ date: "desc" }, { checkIn: "desc" }],
        select: { id: true },
      });
      if (attendance) {
        await prisma.attendance.update({
          // The preceding findFirst is organization-scoped; Prisma's
          // unique update selector accepts only the primary key here.
          where: { id: attendance.id },
          data: {
            securityReviewStatus: status,
            securityReviewNote: String(note || "").trim() || null,
            securityReviewedBy: reviewerId,
            securityReviewedAt: reviewedAt,
          },
        });
      }
    }
    return prisma.auditLog.update({
      where: { id: logId },
      data: { reviewStatus: status, reviewedBy: reviewerId, reviewNote: String(note || "").trim() || null, reviewedAt, attendanceId: attendance?.id || existing.attendanceId || null },
    });
  }
}

module.exports = new AuditService();
