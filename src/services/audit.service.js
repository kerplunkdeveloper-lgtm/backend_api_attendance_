const prisma = require("../config/database");

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
    const { action, entity, userId, page = 1, limit = 50 } = query;
    const where = { organizationId };

    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (userId) where.userId = userId;

    const take = parseInt(limit) || 50;
    const skip = ((parseInt(page) || 1) - 1) * take;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      success: true,
      page: parseInt(page),
      limit: take,
      total,
      totalPages: Math.ceil(total / take) || 1,
      logs,
    };
  }
}

module.exports = new AuditService();
