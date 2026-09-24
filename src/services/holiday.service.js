const prisma = require("../config/database");
const getMidnightDate = (dateInput) => {
  const d = new Date(dateInput);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

class HolidayService {
 
  async createHoliday(organizationId, data) {
    const { name, date, type = "GOVERNMENT", branchId = null, description = null, isOptional = false } = data;

    if (!name || !date) {
      const error = new Error("Holiday name and date are required");
      error.statusCode = 400;
      throw error;
    }

    const validTypes = ["GOVERNMENT", "COMPANY", "OPTIONAL"];
    const holidayType = validTypes.includes(type.toUpperCase()) ? type.toUpperCase() : "GOVERNMENT";
    const dateOnly = getMidnightDate(date);

    // If branchId is provided, ensure the branch belongs to this organization
    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: branchId, organizationId },
      });
      if (!branch) {
        const error = new Error("Selected branch was not found in this organization");
        error.statusCode = 404;
        throw error;
      }
    }

    // Check if an identical holiday already exists on this date for this branch scope
    const existing = await prisma.holiday.findFirst({
      where: {
        organizationId,
        date: dateOnly,
        branchId: branchId || null,
        name,
      },
    });

    if (existing) {
      const error = new Error(`Holiday '${name}' is already configured for this date and branch scope`);
      error.statusCode = 400;
      throw error;
    }

    return await prisma.holiday.create({
      data: {
        organizationId,
        name: name.trim(),
        date: dateOnly,
        type: holidayType,
        branchId: branchId || null,
        description: description ? description.trim() : null,
        isOptional: Boolean(isOptional || holidayType === "OPTIONAL"),
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Bulk ingest holidays from parsed CSV or JSON list
   */
  async bulkCreateHolidays(organizationId, holidaysList) {
    if (!Array.isArray(holidaysList) || holidaysList.length === 0) {
      const error = new Error("A non-empty array of holiday records is required for bulk import");
      error.statusCode = 400;
      throw error;
    }

    const validTypes = ["GOVERNMENT", "COMPANY", "OPTIONAL"];
    const results = {
      created: 0,
      skipped: 0,
      errors: [],
    };

    // Preload organization branches for fast lookup
    const orgBranches = await prisma.branch.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    const branchMap = new Map();
    orgBranches.forEach((b) => {
      branchMap.set(b.id, b.id);
      branchMap.set(b.name.toLowerCase(), b.id);
    });

    await prisma.$transaction(async (tx) => {
      for (const item of holidaysList) {
        try {
          const rawName = item.name || item.holidayName || item["Holiday Name"] || item["holiday_name"] || item.holiday;
          const rawDate = item.date || item.Date || item["Holiday Date"] || item["date"];
          const rawType = item.type || item.Type || item["Holiday Type"] || "GOVERNMENT";
          const rawBranch = item.branch || item.Branch || item.branchName || item.branchId;
          const rawDesc = item.description || item.Description || item.desc || item.note;

          if (!rawName || !rawDate) {
            results.skipped++;
            results.errors.push(`Missing name or date for item: ${JSON.stringify(item)}`);
            continue;
          }

          const name = String(rawName).trim();
          const date = rawDate;
          const type = rawType;
          const branchName = typeof rawBranch === "string" ? rawBranch.trim() : null;
          const branchId = typeof rawBranch === "string" && rawBranch.length > 20 ? rawBranch : null;
          const description = rawDesc;

          let resolvedBranchId = null;
          if (branchId && branchMap.has(branchId)) {
            resolvedBranchId = branchMap.get(branchId);
          } else if (branchName && branchMap.has(branchName.toLowerCase())) {
            resolvedBranchId = branchMap.get(branchName.toLowerCase());
          }

          const holidayType = validTypes.includes(String(type).toUpperCase())
            ? String(type).toUpperCase()
            : "GOVERNMENT";

          const dateOnly = getMidnightDate(date);
          if (!dateOnly || isNaN(dateOnly.getTime())) {
            results.skipped++;
            results.errors.push(`Invalid date format for '${name}': ${date}`);
            continue;
          }

          // Check duplicate
          const existing = await tx.holiday.findFirst({
            where: {
              organizationId,
              date: dateOnly,
              branchId: resolvedBranchId,
              name: name.trim(),
            },
          });

          if (existing) {
            results.skipped++;
            continue;
          }

          await tx.holiday.create({
            data: {
              organizationId,
              name: name.trim(),
              date: dateOnly,
              type: holidayType,
              branchId: resolvedBranchId,
              description: description ? String(description).trim() : null,
              isOptional: holidayType === "OPTIONAL",
            },
          });

          results.created++;
        } catch (err) {
          results.skipped++;
          results.errors.push(err.message);
        }
      }
    });

    return results;
  }

  /**
   * Retrieve holidays with dynamic filtering by year, branch, and type
   */
  async getHolidays(organizationId, query = {}) {
    const { year, branchId, type, scope } = query;

    const where = { organizationId };

    // Filter by year if specified
    if (year) {
      const yr = parseInt(year);
      if (!isNaN(yr)) {
        const startOfYear = new Date(Date.UTC(yr, 0, 1, 0, 0, 0));
        const endOfYear = new Date(Date.UTC(yr, 11, 31, 23, 59, 59));
        where.date = {
          gte: startOfYear,
          lte: endOfYear,
        };
      }
    }

    // Filter by type
    if (type && type !== "ALL") {
      where.type = type.toUpperCase();
    }

    // Filter by branch scope
    if (branchId) {
      // If branchId is specified, include holidays assigned to this branch OR to all branches (null)
      where.OR = [{ branchId: null }, { branchId }];
    } else if (scope === "ORGANIZATION_WIDE") {
      where.branchId = null;
    }

    return await prisma.holiday.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: { date: "asc" },
    });
  }

  /**
   * Update an existing holiday
   */
  async updateHoliday(organizationId, id, data) {
    const holiday = await prisma.holiday.findFirst({
      where: { id, organizationId },
    });

    if (!holiday) {
      const error = new Error("Holiday record not found");
      error.statusCode = 404;
      throw error;
    }

    const { name, date, type, branchId, description, isOptional } = data;
    const updateData = {};

    if (name) updateData.name = name.trim();
    if (date) updateData.date = getMidnightDate(date);
    if (type) {
      const validTypes = ["GOVERNMENT", "COMPANY", "OPTIONAL"];
      if (validTypes.includes(type.toUpperCase())) {
        updateData.type = type.toUpperCase();
      }
    }
    if (branchId !== undefined) {
      if (branchId) {
        const branch = await prisma.branch.findFirst({
          where: { id: branchId, organizationId },
        });
        if (!branch) {
          const error = new Error("Selected branch not found");
          error.statusCode = 404;
          throw error;
        }
        updateData.branchId = branchId;
      } else {
        updateData.branchId = null;
      }
    }
    if (description !== undefined) {
      updateData.description = description ? description.trim() : null;
    }
    if (isOptional !== undefined) {
      updateData.isOptional = Boolean(isOptional);
    }

    return await prisma.holiday.update({
      where: { id },
      data: updateData,
      include: {
        branch: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Delete a holiday
   */
  async deleteHoliday(organizationId, id) {
    const holiday = await prisma.holiday.findFirst({
      where: { id, organizationId },
    });

    if (!holiday) {
      const error = new Error("Holiday not found or already deleted");
      error.statusCode = 404;
      throw error;
    }

    await prisma.holiday.delete({
      where: { id },
    });

    return { success: true, message: `Holiday '${holiday.name}' removed successfully` };
  }

  /**
   * Check if a specific date is an active holiday for an employee's branch
   */
  async isDateHoliday(organizationId, dateInput, branchId = null) {
    const dateOnly = getMidnightDate(dateInput);

    const holiday = await prisma.holiday.findFirst({
      where: {
        organizationId,
        date: dateOnly,
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
    });

    return holiday;
  }

  /**
   * Get upcoming holidays for widgets & notifications
   */
  async getUpcomingHolidays(organizationId, branchId = null, limit = 5) {
    const today = getMidnightDate(new Date());

    return await prisma.holiday.findMany({
      where: {
        organizationId,
        date: { gte: today },
        OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])],
      },
      include: {
        branch: { select: { id: true, name: true } },
      },
      orderBy: { date: "asc" },
      take: limit,
    });
  }
}

module.exports = new HolidayService();
