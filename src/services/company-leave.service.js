const prisma = require("../config/database");
const { toIsoKey } = require("../utils/payrollCycle");

const MAX_SPAN_DAYS = 31;
const DAY_MS = 86400000;

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/** "YYYY-MM-DD" to a UTC date-only value. Rejects anything that is not a real calendar date. */
const parseDay = (value, label) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) throw httpError(`${label} must be in YYYY-MM-DD format`, 400);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (toIsoKey(date) !== `${match[1]}-${match[2]}-${match[3]}`) throw httpError(`${label} is not a valid calendar day`, 400);
  return date;
};

const formatRange = (start, end) =>
  start.getTime() === end.getTime() ? toIsoKey(start) : `${toIsoKey(start)} to ${toIsoKey(end)}`;

class CompanyLeaveService {
  /** Throws if an approved or paid payslip already covers any of these dates. */
  async _assertCyclesOpen(organizationId, start, end) {
    const locked = await prisma.payslip.findFirst({
      where: {
        organizationId,
        status: { in: ["APPROVED", "DISBURSED"] },
        periodStart: { lte: end },
        periodEnd: { gte: start },
      },
      select: { month: true, year: true },
    });
    if (locked) {
      throw httpError(
        `Payroll for ${locked.month}/${locked.year} is already approved, so these dates cannot change`,
        409,
      );
    }
  }

  /**
   * HR announces leave for everyone (or one branch) on a date range. Payroll then treats each
   * day as paid or unpaid leave for every employee in scope. Attendance records are not rewritten.
   */
  async create(organizationId, actor = {}, data = {}) {
    const title = String(data.title || "").trim();
    if (!title) throw httpError("Give the company leave a title", 400);
    if (title.length > 120) throw httpError("Title must be 120 characters or fewer", 400);
    const reason = String(data.reason || "").trim();
    if (reason.length > 500) throw httpError("Reason must be 500 characters or fewer", 400);

    const startDate = parseDay(data.startDate, "Start date");
    const endDate = parseDay(data.endDate, "End date");
    if (endDate < startDate) throw httpError("End date cannot be before the start date", 400);
    const span = Math.round((endDate - startDate) / DAY_MS) + 1;
    if (span > MAX_SPAN_DAYS) throw httpError(`A company leave can cover at most ${MAX_SPAN_DAYS} days`, 400);

    const branchId = data.branchId ? String(data.branchId) : null;
    if (branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true, name: true } });
      if (!branch) throw httpError("Branch not found in this organization", 404);
    }

    const overlapping = await prisma.companyLeave.findFirst({
      where: {
        organizationId,
        branchId,
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { title: true, startDate: true, endDate: true },
    });
    if (overlapping) {
      throw httpError(
        `"${overlapping.title}" already covers ${formatRange(overlapping.startDate, overlapping.endDate)}`,
        409,
      );
    }

    await this._assertCyclesOpen(organizationId, startDate, endDate);

    const record = await prisma.companyLeave.create({
      data: {
        organizationId,
        branchId,
        title,
        reason: reason || null,
        startDate,
        endDate,
        isPaid: data.isPaid === true || data.isPaid === "true",
        createdBy: actor.id || null,
      },
      include: { branch: { select: { name: true } } },
    });

    let notified = 0;
    if (data.notify !== false) {
      const employees = await prisma.employee.findMany({
        where: {
          organizationId,
          deletedAt: null,
          userId: { not: null },
          status: { notIn: ["INACTIVE", "TERMINATED"] },
          ...(branchId ? { branchId } : {}),
        },
        select: { userId: true },
      });
      const message = `${formatRange(startDate, endDate)} · ${record.isPaid ? "Paid" : "Unpaid"} company leave.${reason ? ` ${reason}` : ""}`;
      if (employees.length > 0) {
        const result = await prisma.notification.createMany({
          data: employees.map((employee) => ({
            organizationId,
            userId: employee.userId,
            title: `Company leave: ${title}`,
            message,
            type: "SYSTEM",
          })),
        });
        notified = result.count;
      }
    }

    return { ...record, notified };
  }

  /** Company leave that touches a date range, for the calendar and the review list. */
  async list(organizationId, query = {}) {
    const where = { organizationId };
    if (query.from) where.endDate = { gte: parseDay(query.from, "From") };
    if (query.to) where.startDate = { lte: parseDay(query.to, "To") };
    return prisma.companyLeave.findMany({
      where,
      include: { branch: { select: { name: true } } },
      orderBy: { startDate: "desc" },
      take: 200,
    });
  }

  async remove(organizationId, id) {
    const record = await prisma.companyLeave.findFirst({ where: { id, organizationId } });
    if (!record) throw httpError("Company leave not found", 404);
    await this._assertCyclesOpen(organizationId, record.startDate, record.endDate);
    await prisma.companyLeave.delete({ where: { id: record.id } });
    return { id: record.id };
  }
}

module.exports = new CompanyLeaveService();
