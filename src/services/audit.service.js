const prisma = require("../config/database");
const { parsePagination } = require("../utils/pagination");

class AuditService {
  /**
   * Log an administrative or sensitive action
   */
  async logAction({ organizationId, userId, action, entity, entityId, details, ipAddress }) {
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
    const { action, entity, userId, from, to, page = 1, limit = 50 } = query;
    const where = { organizationId, entity: { not: "PLATFORM" } };

    if (action) where.action = action;
    if (entity && entity !== "PLATFORM") where.entity = entity;
    if (userId) where.userId = userId;
    // Dates are inclusive of the whole "to" day.
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if ((fromDate && !Number.isNaN(fromDate.getTime())) || (toDate && !Number.isNaN(toDate.getTime()))) {
      where.createdAt = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) where.createdAt.gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) where.createdAt.lt = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const { limit: take, skip, page: curPage } = parsePagination({ page, limit }, { defaultLimit: 50 });

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.auditLog.count({ where }),
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
    const enriched = logs.map((log) => ({ ...log, actor: actorById.get(log.userId) || null }));

    return {
      success: true,
      page: curPage,
      limit: take,
      total,
      totalPages: Math.ceil(total / take) || 1,
      logs: enriched,
      data: enriched,
    };
  }
}

module.exports = new AuditService();
