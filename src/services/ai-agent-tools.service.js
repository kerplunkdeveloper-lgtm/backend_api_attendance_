const prisma = require("../config/database");

const TEAM_ROLES = new Set(["MANAGER", "HR", "COMPANY_ADMIN", "SUPER_ADMIN"]);
const SALARY_ROLES = new Set(["HR", "COMPANY_ADMIN", "SUPER_ADMIN"]);
const ADMIN_ROLES = new Set(["COMPANY_ADMIN", "SUPER_ADMIN"]);

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const text = (value, max = 120) => String(value || "").trim().slice(0, max);
const number = (value) => value == null ? value : Number(value?.toJSON ? value.toJSON() : value);
const serialise = (value) => {
  if (value == null) return value;
  if (value?.toJSON) return value.toJSON();
  if (Array.isArray(value)) return value.map(serialise);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  return value;
};

function assertTeamAccess(user) {
  if (!TEAM_ROLES.has(user?.role)) throw fail("You do not have permission to view team employee data.", 403);
}

function assertSalaryAccess(user) {
  if (!SALARY_ROLES.has(user?.role)) throw fail("You do not have permission to view this employee's salary details.", 403);
}

function scopeWhere(user) {
  const where = { organizationId: user.organizationId, deletedAt: null };
  if (user.role === "MANAGER") {
    if (!user.employee?.departmentId) throw fail("Your manager scope is not configured.", 403);
    where.departmentId = user.employee.departmentId;
  }
  return where;
}

function employeeWhere(user, args = {}) {
  const requestedId = text(args.employeeId, 80);
  const requestedCode = text(args.employeeCode, 80);
  const ownId = user.employee?.id;
  if (user.role === "EMPLOYEE") {
    if (requestedId && requestedId !== ownId) throw fail("You do not have permission to view this employee's information.", 403);
    if (requestedCode && requestedCode.toLowerCase() !== String(user.employee?.employeeCode || "").toLowerCase()) throw fail("You do not have permission to view this employee's information.", 403);
    if (!ownId) throw fail("Your employee profile is not available.", 404);
    return { id: ownId, organizationId: user.organizationId, deletedAt: null };
  }
  if (!requestedId && !requestedCode) throw fail("Provide an employee code or select an employee.");
  return { ...scopeWhere(user), ...(requestedId ? { id: requestedId } : { employeeCode: requestedCode }) };
}

async function getEmployee(user, args = {}) {
  const employee = await prisma.employee.findFirst({
    where: employeeWhere(user, args),
    select: {
      id: true, employeeCode: true, firstName: true, lastName: true, status: true,
      designation: true, dateOfJoining: true, employmentType: true, workEmail: true,
      department: { select: { name: true } }, branch: { select: { name: true } },
      shift: { select: { name: true, startTime: true, endTime: true, graceMinutes: true } },
      reportingManager: { select: { employeeCode: true, firstName: true, lastName: true } },
    },
  });
  if (!employee) throw fail("Employee not found in your authorized scope.", 404);
  return employee;
}

async function searchAuthorizedEmployee(user, args = {}) {
  assertTeamAccess(user);
  const code = text(args.employeeCode, 80);
  if (!code) throw fail("Employee code is required.");
  const employee = await getEmployee(user, { employeeCode: code });
  return { employee: { id: employee.id, employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim(), department: employee.department?.name || null, branch: employee.branch?.name || null, status: employee.status } };
}

async function getEmployeeProfile(user, args = {}) {
  const employee = await getEmployee(user, args);
  const [documentCount, verifiedDocumentCount] = await Promise.all([
    prisma.employeeDocument.count({ where: { organizationId: user.organizationId, employeeId: employee.id } }),
    prisma.employeeDocument.count({ where: { organizationId: user.organizationId, employeeId: employee.id, status: "VERIFIED" } }),
  ]);
  return {
    employee: {
      id: employee.id, employeeCode: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName || ""}`.trim(), status: employee.status,
      designation: employee.designation, department: employee.department?.name || null,
      branch: employee.branch?.name || null, joiningDate: employee.dateOfJoining,
      employmentType: employee.employmentType, workEmail: employee.workEmail,
      reportingManager: employee.reportingManager ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName || ""}`.trim() : null,
      shift: employee.shift || null,
    },
    documents: { total: documentCount, verified: verifiedDocumentCount, pending: documentCount - verifiedDocumentCount },
  };
}

async function getEmployeeSalaryStructure(user, args = {}) {
  assertSalaryAccess(user);
  const employee = await getEmployee(user, args);
  const structure = await prisma.salaryStructure.findFirst({ where: { organizationId: user.organizationId, employeeId: employee.id }, select: { annualCtc: true, monthlyCtc: true, baseSalary: true, hra: true, transport: true, special: true, otherAllowance: true, pf: true, esi: true, professionalTax: true, overtimeRate: true } });
  if (!structure) return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, message: "No salary structure is available for this employee." };
  return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, salaryStructure: serialise(structure) };
}

async function getEmployeePayrollBreakdown(user, args = {}) {
  assertSalaryAccess(user);
  const employee = await getEmployee(user, args);
  const where = { organizationId: user.organizationId, employeeId: employee.id };
  if (args.month != null || args.year != null) {
    const month = Number(args.month); const year = Number(args.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) throw fail("Invalid payroll period.");
    where.month = month; where.year = year;
  }
  const payslip = await prisma.payslip.findFirst({ where, orderBy: [{ year: "desc" }, { month: "desc" }], select: { month: true, year: true, workingDays: true, presentDays: true, paidLeaveDays: true, unpaidLeaveDays: true, overtimeHours: true, baseSalary: true, hra: true, transport: true, special: true, otherAllowance: true, allowancesTotal: true, overtimePay: true, grossSalary: true, unpaidLeaveDeduction: true, hoursShortfallDeduction: true, lateDeduction: true, pfDeduction: true, esiDeduction: true, ptDeduction: true, statutoryDeductions: true, tdsDeduction: true, deductionsTotal: true, reimbursements: true, loanRecovery: true, permissionDeduction: true, breakDeduction: true, lunchDeduction: true, pauseDeduction: true, netSalary: true, status: true, remarks: true } });
  if (!payslip) return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, message: "No finalized payslip is available for the requested period." };
  return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, payrollPeriod: { month: payslip.month, year: payslip.year }, payslip: serialise(payslip) };
}

async function getEmployeeAttendance(user, args = {}) {
  const employee = await getEmployee(user, args);
  const year = Number(args.year); const month = Number(args.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw fail("A valid attendance year and month are required.");
  const from = new Date(Date.UTC(year, month - 1, 1)); const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.attendance.findMany({ where: { organizationId: user.organizationId, employeeId: employee.id, date: { gte: from, lt: to } }, select: { date: true, status: true, checkIn: true, checkOut: true, workingMinutes: true, lateMinutes: true, earlyMinutes: true, overtimeMinutes: true, checkInLocation: true, checkOutLocation: true }, orderBy: { date: "asc" }, take: 62 });
  return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, year, month, summary: { records: rows.length, presentDays: rows.filter((r) => !["ABSENT", "LEAVE"].includes(r.status)).length, absentDays: rows.filter((r) => r.status === "ABSENT").length, lateDays: rows.filter((r) => r.lateMinutes > 0 || r.status === "LATE").length, earlyDepartureDays: rows.filter((r) => r.earlyMinutes > 0).length, workingMinutes: rows.reduce((sum, r) => sum + (r.workingMinutes || 0), 0), overtimeMinutes: rows.reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0) }, records: serialise(rows) };
}

async function getAttendancePunchDetails(user, args = {}) {
  const date = text(args.date, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail("A valid attendance date is required in YYYY-MM-DD format.");
  const selector = args.employeeId || args.employeeCode
    ? { employeeId: args.employeeId, employeeCode: args.employeeCode }
    : { employeeId: user.employee?.id };
  const employee = await getEmployee(user, selector);
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T00:00:00.000Z`);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const row = await prisma.attendance.findFirst({
    where: { organizationId: user.organizationId, employeeId: employee.id, date: { gte: dayStart, lt: dayEnd } },
    select: { date: true, status: true, checkIn: true, checkOut: true, workingMinutes: true, lateMinutes: true, earlyMinutes: true, overtimeMinutes: true, breakMinutes: true, lunchMinutes: true, checkInLocation: true, checkOutLocation: true },
    orderBy: { updatedAt: "desc" },
  });
  const timezone = user.organization?.timezone || "Asia/Kolkata";
  const formatTime = (value) => value ? new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value)) : null;
  return {
    verified: true,
    date,
    timezone,
    employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() },
    record: row ? { status: row.status, checkIn: row.checkIn, checkOut: row.checkOut, checkInTime: formatTime(row.checkIn), checkOutTime: formatTime(row.checkOut), workingMinutes: row.workingMinutes, lateMinutes: row.lateMinutes, earlyMinutes: row.earlyMinutes, overtimeMinutes: row.overtimeMinutes, breakMinutes: row.breakMinutes, lunchMinutes: row.lunchMinutes, checkInLocation: row.checkInLocation, checkOutLocation: row.checkOutLocation } : null,
  };
}

async function getEmployeeLeaveHistory(user, args = {}) {
  const employee = await getEmployee(user, args);
  const status = args.status ? text(args.status, 30).toUpperCase() : undefined;
  const requests = await prisma.leaveRequest.findMany({ where: { organizationId: user.organizationId, employeeId: employee.id, ...(status ? { status } : {}) }, select: { startDate: true, endDate: true, totalDays: true, status: true, reason: true, reviewNote: true, leaveType: { select: { name: true, code: true, isPaid: true } } }, orderBy: { startDate: "desc" }, take: 100 });
  return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, requests: serialise(requests) };
}

async function getEmployeeOvertime(user, args = {}) {
  const employee = await getEmployee(user, args);
  const requests = await prisma.overtimeRequest.findMany({ where: { organizationId: user.organizationId, employeeId: employee.id, ...(args.status ? { status: text(args.status, 30).toUpperCase() } : {}) }, select: { requestedMinutes: true, approvedMinutes: true, status: true, reason: true, createdAt: true, attendance: { select: { date: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return { employee: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName || ""}`.trim() }, overtime: serialise(requests) };
}

async function getCompanyPolicies(user, args = {}) {
  const query = text(args.query, 200).toLowerCase();
  const policies = await prisma.companyPolicy.findMany({ where: { organizationId: user.organizationId, isPublished: true, archivedAt: null, ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { description: { contains: query, mode: "insensitive" } }] } : {}) }, select: { id: true, title: true, description: true, category: true, fileName: true, publishedAt: true }, orderBy: { updatedAt: "desc" }, take: 20 });
  return { policies };
}

async function getDepartmentSummary(user) {
  assertTeamAccess(user);
  const employees = await prisma.employee.groupBy({ by: ["departmentId", "status"], where: scopeWhere(user), _count: { _all: true } });
  return { scope: user.role === "MANAGER" ? "department" : "organization", departments: employees };
}

async function getAuthorizedOrganizationSummary(user) {
  if (!ADMIN_ROLES.has(user.role)) throw fail("You do not have permission to view organization-wide summaries.", 403);
  const where = { organizationId: user.organizationId, deletedAt: null };
  const [employees, departments, branches] = await Promise.all([prisma.employee.count({ where }), prisma.department.count({ where: { organizationId: user.organizationId } }), prisma.branch.count({ where: { organizationId: user.organizationId } })]);
  return { scope: "organization", employees, departments, branches };
}

module.exports = { searchAuthorizedEmployee, getEmployeeProfile, getEmployeeSalaryStructure, getEmployeePayrollBreakdown, getEmployeeAttendance, getAttendancePunchDetails, getEmployeeLeaveHistory, getEmployeeOvertime, getCompanyPolicies, getDepartmentSummary, getAuthorizedOrganizationSummary, employeeWhere };
