const prisma = require("../config/database");
const { getTodayDateOnly } = require("./attendance.service");

class ShiftOverrideService {
  /**
   * Set or update a per-day shift override for an employee
   */
  async setOverride(organizationId, adminUserId, { employeeId, date, shiftId, reason }) {
    if (!employeeId || !date || !shiftId) {
      const error = new Error("employeeId, date, and shiftId are required");
      error.statusCode = 400;
      throw error;
    }

    // Validate employee belongs to org
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId } });
    if (!employee) {
      const error = new Error("Employee not found in this organization");
      error.statusCode = 404;
      throw error;
    }

    // Validate shift belongs to org
    const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
    if (!shift) {
      const error = new Error("Shift not found in this organization");
      error.statusCode = 404;
      throw error;
    }

    const targetDate = getTodayDateOnly(new Date(date));

    const override = await prisma.shiftOverride.upsert({
      where: { employeeId_date: { employeeId, date: targetDate } },
      update: { shiftId, reason: reason || null },
      create: {
        organizationId,
        employeeId,
        date: targetDate,
        shiftId,
        reason: reason || null,
        createdBy: adminUserId,
      },
      include: {
        shift: { select: { id: true, name: true, startTime: true, endTime: true, graceMinutes: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      },
    });

    return { success: true, message: `Shift override set for ${employee.firstName} on ${date}`, override };
  }

  /**
   * Delete a shift override
   */
  async deleteOverride(organizationId, employeeId, date) {
    const targetDate = getTodayDateOnly(new Date(date));

    const deleted = await prisma.shiftOverride.deleteMany({
      where: { employeeId, date: targetDate, organizationId },
    });

    if (deleted.count === 0) {
      const error = new Error("No shift override found for this employee on that date");
      error.statusCode = 404;
      throw error;
    }

    return { success: true, message: "Shift override removed" };
  }

  /**
   * Get all shift overrides for an employee
   */
  async getEmployeeOverrides(organizationId, employeeId, query = {}) {
    const { from, to } = query;
    const where = { organizationId, employeeId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = getTodayDateOnly(new Date(from));
      if (to) where.date.lte = getTodayDateOnly(new Date(to));
    }

    return await prisma.shiftOverride.findMany({
      where,
      include: {
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: "desc" },
    });
  }

  /**
   * Get all org-wide shift overrides for a date range (admin view)
   */
  async getOrganizationOverrides(organizationId, query = {}) {
    const { from, to, employeeId } = query;
    const where = { organizationId };
    if (employeeId) where.employeeId = employeeId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = getTodayDateOnly(new Date(from));
      if (to) where.date.lte = getTodayDateOnly(new Date(to));
    }

    return await prisma.shiftOverride.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: "desc" },
    });
  }
}

module.exports = new ShiftOverrideService();
