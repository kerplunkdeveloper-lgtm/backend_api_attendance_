const prisma = require("../config/database");
const { WORKING_STATUSES } = require("../utils/employeeStatus");

function parseRange(query = {}) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    const error = new Error("A valid prediction date range is required.");
    error.statusCode = 400;
    throw error;
  }
  return { from, to };
}

function riskLevel(score) {
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

/**
 * Explainable workforce risk forecast. This is intentionally deterministic:
 * HR can see exactly why a person is flagged, and the score can be replaced
 * by a trained model later without changing the API contract.
 */
async function attendancePredictions(user, query = {}) {
  const { from, to } = parseRange(query);
  const employeeScope = {
    organizationId: user.organizationId,
    deletedAt: null,
    status: { in: WORKING_STATUSES },
    user: { role: { notIn: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
    ...(user.role === "MANAGER" ? { departmentId: user.employee?.departmentId } : {}),
  };
  if (user.role === "MANAGER" && !user.employee?.departmentId) {
    const error = new Error("Your manager scope is not configured.");
    error.statusCode = 403;
    throw error;
  }

  const [employees, rows] = await Promise.all([
    prisma.employee.findMany({
      where: employeeScope,
      select: { id: true, employeeCode: true, firstName: true, lastName: true, branchId: true, departmentId: true },
    }),
    prisma.attendance.findMany({
      where: { organizationId: user.organizationId, date: { gte: from, lte: to }, employee: employeeScope },
      select: { employeeId: true, date: true, status: true, lateMinutes: true, workingMinutes: true, checkIn: true, checkOut: true },
    }),
  ]);

  const byEmployee = new Map();
  for (const row of rows) {
    const item = byEmployee.get(row.employeeId) || { records: 0, absent: 0, late: 0, shortHours: 0, missingPunchOut: 0, totalWorkingMinutes: 0 };
    item.records += 1;
    item.absent += row.status === "ABSENT" ? 1 : 0;
    item.late += row.status === "LATE" || (row.lateMinutes || 0) > 0 ? 1 : 0;
    item.shortHours += row.status === "SHORT_HOURS" ? 1 : 0;
    item.missingPunchOut += row.checkIn && !row.checkOut ? 1 : 0;
    item.totalWorkingMinutes += row.workingMinutes || 0;
    byEmployee.set(row.employeeId, item);
  }

  const predictions = employees.map((employee) => {
    const item = byEmployee.get(employee.id) || { records: 0, absent: 0, late: 0, shortHours: 0, missingPunchOut: 0, totalWorkingMinutes: 0 };
    const score = Math.min(100, item.absent * 20 + item.late * 8 + item.shortHours * 12 + item.missingPunchOut * 5);
    const reasons = [];
    if (item.absent) reasons.push(`${item.absent} absent day${item.absent === 1 ? "" : "s"}`);
    if (item.late) reasons.push(`${item.late} late arrival${item.late === 1 ? "" : "s"}`);
    if (item.shortHours) reasons.push(`${item.shortHours} short-hour record${item.shortHours === 1 ? "" : "s"}`);
    if (item.missingPunchOut) reasons.push(`${item.missingPunchOut} missing punch-out${item.missingPunchOut === 1 ? "" : "s"}`);
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      name: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
      branchId: employee.branchId,
      departmentId: employee.departmentId,
      riskScore: score,
      riskLevel: riskLevel(score),
      reasons,
      observedRecords: item.records,
      averageWorkingMinutes: item.records ? Math.round(item.totalWorkingMinutes / item.records) : 0,
    };
  }).sort((a, b) => b.riskScore - a.riskScore || a.name.localeCompare(b.name));

  return {
    type: "EXPLAINABLE_ATTENDANCE_RISK",
    scope: user.role === "MANAGER" ? "department" : "organization",
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    methodology: "Absent=20, late=8, short-hours=12, missing punch-out=5; score capped at 100.",
    predictions,
    summary: {
      employeesEvaluated: predictions.length,
      highRisk: predictions.filter((p) => p.riskLevel === "HIGH").length,
      mediumRisk: predictions.filter((p) => p.riskLevel === "MEDIUM").length,
      lowRisk: predictions.filter((p) => p.riskLevel === "LOW").length,
    },
  };
}

module.exports = { attendancePredictions };
