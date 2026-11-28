const prisma = require("../config/database");
const { WORKING_STATUSES } = require("../utils/employeeStatus");

async function attendanceAnalytics(user, query = {}) {
  const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : new Date();
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) { const error = new Error("A valid date range is required."); error.statusCode = 400; throw error; }
  const employeeScope = { organizationId: user.organizationId, deletedAt: null, status: { in: WORKING_STATUSES }, user: { role: { notIn: ["SUPER_ADMIN", "COMPANY_ADMIN"] } }, ...(user.role === "MANAGER" ? { departmentId: user.employee?.departmentId } : {}) };
  if (user.role === "MANAGER" && !user.employee?.departmentId) { const error = new Error("Your manager scope is not configured."); error.statusCode = 403; throw error; }
  const [employees, rows, leaves] = await Promise.all([
    prisma.employee.findMany({ where: employeeScope, select: { id: true, branchId: true, departmentId: true } }),
    prisma.attendance.findMany({ where: { organizationId: user.organizationId, date: { gte: from, lte: to }, employee: employeeScope }, select: { date: true, status: true, lateMinutes: true, workingMinutes: true, overtimeMinutes: true, checkIn: true, checkOut: true, branchId: true } }),
    prisma.leaveRequest.count({ where: { organizationId: user.organizationId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from }, employee: employeeScope } }),
  ]);
  const byStatus = {};
  const daily = new Map();
  const byBranch = new Map();
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const day = row.date.toISOString().slice(0, 10);
    const item = daily.get(day) || { date: day, records: 0, late: 0, workingMinutes: 0, overtimeMinutes: 0, missingPunchOut: 0 };
    item.records += 1; item.late += row.status === "LATE" || row.lateMinutes > 0 ? 1 : 0; item.workingMinutes += row.workingMinutes || 0; item.overtimeMinutes += row.overtimeMinutes || 0; item.missingPunchOut += row.checkIn && !row.checkOut ? 1 : 0; daily.set(day, item);
    const branch = row.branchId || "UNASSIGNED";
    const branchItem = byBranch.get(branch) || { branchId: row.branchId || null, records: 0, late: 0, workingMinutes: 0, overtimeMinutes: 0 };
    branchItem.records += 1; branchItem.late += row.status === "LATE" || row.lateMinutes > 0 ? 1 : 0; branchItem.workingMinutes += row.workingMinutes || 0; branchItem.overtimeMinutes += row.overtimeMinutes || 0; byBranch.set(branch, branchItem);
  }
  return { scope: user.role === "MANAGER" ? "department" : "organization", range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }, totals: { employees: employees.length, attendanceRecords: rows.length, approvedLeaveRequests: leaves, lateRecords: rows.filter((row) => row.status === "LATE" || row.lateMinutes > 0).length, missingPunchOut: rows.filter((row) => row.checkIn && !row.checkOut).length, workingMinutes: rows.reduce((sum, row) => sum + (row.workingMinutes || 0), 0), overtimeMinutes: rows.reduce((sum, row) => sum + (row.overtimeMinutes || 0), 0) }, byStatus, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), byBranch: [...byBranch.values()] };
}

module.exports = { attendanceAnalytics };
