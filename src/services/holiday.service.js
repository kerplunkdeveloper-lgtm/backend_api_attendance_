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

    if (holidaysList.length > 1000) {
      const error = new Error("Bulk holiday import is limited to 1000 rows per request");
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

    // Validate and normalise every row in memory first. The previous version
    // ran two queries per row inside one interactive transaction, which over a
    // remote database exceeded Prisma's 5s transaction timeout on normal lists.
    const candidates = [];
    for (const item of holidaysList) {
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
      const branchName = typeof rawBranch === "string" ? rawBranch.trim() : null;
      const branchId = typeof rawBranch === "string" && rawBranch.length > 20 ? rawBranch : null;

      let resolvedBranchId = null;
      if (branchId && branchMap.has(branchId)) {
        resolvedBranchId = branchMap.get(branchId);
      } else if (branchName && branchMap.has(branchName.toLowerCase())) {
        resolvedBranchId = branchMap.get(branchName.toLowerCase());
      }

      const holidayType = validTypes.includes(String(rawType).toUpperCase())
        ? String(rawType).toUpperCase()
        : "GOVERNMENT";

      const dateOnly = getMidnightDate(rawDate);
      if (!dateOnly || isNaN(dateOnly.getTime())) {
        results.skipped++;
        results.errors.push(`Invalid date format for '${name}': ${rawDate}`);
        continue;
      }

      candidates.push({
        organizationId,
        name,
        date: dateOnly,
        type: holidayType,
        branchId: resolvedBranchId,
        description: rawDesc ? String(rawDesc).trim() : null,
        isOptional: holidayType === "OPTIONAL",
      });
    }

    if (candidates.length > 0) {
      // One read for existing rows. De-duplication is done here (not by the
      // unique index) because branchId is NULL for org-wide holidays and
      // Postgres treats NULLs as distinct in unique constraints.
      const times = candidates.map((c) => c.date.getTime());
      const existing = await prisma.holiday.findMany({
        where: {
          organizationId,
          date: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) },
        },
        select: { date: true, branchId: true, name: true },
      });
      const keyOf = (h) => `${h.date.getTime()}|${h.branchId || ""}|${h.name.toLowerCase()}`;
      const seen = new Set(existing.map(keyOf));

      const toCreate = [];
      for (const candidate of candidates) {
        const key = keyOf(candidate);
        if (seen.has(key)) {
          results.skipped++;
          continue;
        }
        seen.add(key);
        toCreate.push(candidate);
      }

      if (toCreate.length > 0) {
        // A single statement is atomic, so no interactive transaction is needed.
        const inserted = await prisma.holiday.createMany({ data: toCreate, skipDuplicates: true });
        results.created += inserted.count;
        results.skipped += toCreate.length - inserted.count;
      }
    }

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
