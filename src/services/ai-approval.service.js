const prisma = require("../config/database");
const leaveService = require("./leave.service");
const shootRequestService = require("./shoot-request.service");
const shootSettlementService = require("./shoot-settlement.service");
const workFromHomeService = require("./work-from-home.service");
const overtimeService = require("./overtime.service");
const expenseService = require("./expense.service");
const correctionService = require("./correction.service");
const permissionService = require("./permission.service");
const dayOffWorkService = require("./dayoff-work.service");
const compOffService = require("./compoff.service");
const loanService = require("./loan.service");

const REVIEWER_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"];
const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];
const MAX_ITEMS = 100;

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const APPROVAL_TYPES = [
  "LEAVE",
  "LEAVE_DATE_CHANGE",
  "SHOOT_REQUEST",
  "SHOOT_CANCELLATION",
  "SHOOT_SETTLEMENT",
  "SHOOT_SETTLEMENT_OVERTIME",
  "WORK_FROM_HOME",
  "OVERTIME",
  "EXPENSE",
  "ATTENDANCE_CORRECTION",
  "PERMISSION",
  "DAY_OFF_WORK",
  "COMP_OFF",
  "LOAN",
];

const aliases = {
  leave: "LEAVE",
  leaves: "LEAVE",
  date_change: "LEAVE_DATE_CHANGE",
  "leave-date-change": "LEAVE_DATE_CHANGE",
  shoot: "SHOOT_REQUEST",
  shoot_request: "SHOOT_REQUEST",
  "shoot-request": "SHOOT_REQUEST",
  cancellation: "SHOOT_CANCELLATION",
  shoot_cancellation: "SHOOT_CANCELLATION",
  settlement: "SHOOT_SETTLEMENT",
  shoot_settlement: "SHOOT_SETTLEMENT",
  shoot_overtime: "SHOOT_SETTLEMENT_OVERTIME",
  wfh: "WORK_FROM_HOME",
  work_from_home: "WORK_FROM_HOME",
  overtime: "OVERTIME",
  ot: "OVERTIME",
  expense: "EXPENSE",
  claim: "EXPENSE",
  correction: "ATTENDANCE_CORRECTION",
  attendance_correction: "ATTENDANCE_CORRECTION",
  permission: "PERMISSION",
  day_off: "DAY_OFF_WORK",
  day_off_work: "DAY_OFF_WORK",
  compoff: "COMP_OFF",
  comp_off: "COMP_OFF",
  loan: "LOAN",
  advance: "LOAN",
};

const normalizeApprovalType = (value) => {
  const normalized = String(value || "").trim().toUpperCase().replace(/[ -]+/g, "_");
  const type = aliases[normalized.toLowerCase()] || normalized;
  if (!APPROVAL_TYPES.includes(type)) throw fail(`Unsupported approval type. Choose one of: ${APPROVAL_TYPES.join(", ")}.`);
  return type;
};

const assertReviewer = (user) => {
  if (!REVIEWER_ROLES.includes(user?.role)) throw fail("Only HR, managers, and administrators can review approvals.", 403);
  if (user.role === "MANAGER" && !user.employee?.departmentId) throw fail("Your manager approval scope is not configured.", 403);
};

const employeeScope = (user) => {
  const scope = {};
  if (user.role === "MANAGER") scope.departmentId = user.employee.departmentId;
  if (!ADMIN_ROLES.includes(user.role)) scope.user = { is: { role: "EMPLOYEE" } };
  return scope;
};

const employeeSelect = { id: true, firstName: true, lastName: true, employeeCode: true, department: { select: { name: true } } };
const employeeSummary = (employee) => employee ? {
  id: employee.id,
  code: employee.employeeCode,
  name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim(),
  department: employee.department?.name || null,
} : null;

const withCommon = (type, row) => ({
  type,
  id: row.id,
  status: row.status || "PENDING",
  employee: employeeSummary(row.employee),
  createdAt: row.createdAt,
  request: row,
});

async function getPendingApprovals(user, args = {}) {
  assertReviewer(user);
  const requestedType = args.type ? normalizeApprovalType(args.type) : null;
  const take = Math.min(Math.max(Number(args.limit) || 50, 1), MAX_ITEMS);
  const organizationId = user.organizationId;
  const employee = employeeScope(user);
  const types = requestedType ? [requestedType] : APPROVAL_TYPES;
  const output = [];

  const add = (type, rows) => {
    if (types.includes(type)) output.push(...rows.map((row) => withCommon(type, row)));
  };

  if (types.includes("LEAVE")) add("LEAVE", await prisma.leaveRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, startDate: true, endDate: true, totalDays: true, reason: true, createdAt: true, leaveType: { select: { name: true, code: true } }, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("LEAVE_DATE_CHANGE")) add("LEAVE_DATE_CHANGE", await prisma.leaveChangeRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, oldStartDate: true, oldEndDate: true, newStartDate: true, newEndDate: true, reason: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("SHOOT_REQUEST") || types.includes("SHOOT_CANCELLATION")) {
    const rows = await prisma.shootRequest.findMany({ where: { organizationId, status: types.includes("SHOOT_REQUEST") && types.includes("SHOOT_CANCELLATION") ? { in: ["PENDING", "APPROVED"] } : types.includes("SHOOT_REQUEST") ? "PENDING" : "APPROVED", ...(types.includes("SHOOT_CANCELLATION") && !types.includes("SHOOT_REQUEST") ? { cancellationRequested: true } : {}), employee }, select: { id: true, status: true, date: true, shootName: true, location: true, startTime: true, endTime: true, note: true, cancellationRequested: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take });
    if (types.includes("SHOOT_REQUEST")) add("SHOOT_REQUEST", rows.filter((row) => row.status === "PENDING"));
    if (types.includes("SHOOT_CANCELLATION")) add("SHOOT_CANCELLATION", rows.filter((row) => row.cancellationRequested));
  }
  if (types.includes("SHOOT_SETTLEMENT") || types.includes("SHOOT_SETTLEMENT_OVERTIME")) {
    const rows = await prisma.shootSettlement.findMany({ where: { organizationId, status: types.includes("SHOOT_SETTLEMENT") && types.includes("SHOOT_SETTLEMENT_OVERTIME") ? { in: ["PENDING", "APPROVED"] } : types.includes("SHOOT_SETTLEMENT") ? "PENDING" : "APPROVED", ...(types.includes("SHOOT_SETTLEMENT_OVERTIME") && !types.includes("SHOOT_SETTLEMENT") ? { OR: [{ shootOvertimeStatus: "PENDING" }, { travelOvertimeStatus: "PENDING" }] } : {}), employee }, select: { id: true, status: true, overtimeStatus: true, shootOvertimeStatus: true, travelOvertimeStatus: true, shootDate: true, shootMinutes: true, travelMinutes: true, createdAt: true, employee: { select: employeeSelect }, shootRequest: { select: { shootName: true, location: true } } }, orderBy: { createdAt: "asc" }, take });
    if (types.includes("SHOOT_SETTLEMENT")) add("SHOOT_SETTLEMENT", rows.filter((row) => row.status === "PENDING"));
    if (types.includes("SHOOT_SETTLEMENT_OVERTIME")) add("SHOOT_SETTLEMENT_OVERTIME", rows.filter((row) => row.status === "APPROVED" && (row.shootOvertimeStatus === "PENDING" || row.travelOvertimeStatus === "PENDING")));
  }
  if (types.includes("WORK_FROM_HOME")) add("WORK_FROM_HOME", await prisma.workFromHomeRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, startDate: true, endDate: true, reason: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("OVERTIME")) add("OVERTIME", await prisma.overtimeRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, requestedMinutes: true, plannedStartTime: true, plannedEndTime: true, reason: true, createdAt: true, employee: { select: employeeSelect }, attendance: { select: { date: true } } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("EXPENSE")) add("EXPENSE", await prisma.expenseClaim.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, title: true, category: true, amount: true, date: true, description: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("ATTENDANCE_CORRECTION")) add("ATTENDANCE_CORRECTION", await prisma.attendanceCorrection.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, date: true, requestedCheckIn: true, requestedCheckOut: true, reason: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("PERMISSION")) add("PERMISSION", await prisma.permissionRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, date: true, startTime: true, endTime: true, hours: true, reason: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("DAY_OFF_WORK")) add("DAY_OFF_WORK", await prisma.dayOffWorkRequest.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, date: true, dayKind: true, reasonType: true, note: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));
  if (types.includes("COMP_OFF")) {
    const rows = await prisma.compOffTransaction.findMany({ where: { type: "PENDING_DEBIT", compOffBalance: { organizationId, employee } }, select: { id: true, type: true, days: true, reason: true, referenceDate: true, createdAt: true, compOffBalance: { select: { employee: { select: employeeSelect } } } }, orderBy: { createdAt: "asc" }, take });
    add("COMP_OFF", rows.map((row) => ({ ...row, status: "PENDING", employee: row.compOffBalance?.employee })));
  }
  if (types.includes("LOAN")) add("LOAN", await prisma.loanAdvance.findMany({ where: { organizationId, status: "PENDING", employee }, select: { id: true, status: true, type: true, amount: true, monthlyRecovery: true, reason: true, createdAt: true, employee: { select: employeeSelect } }, orderBy: { createdAt: "asc" }, take }));

  output.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const items = output.slice(0, take);
  return { scope: user.role === "MANAGER" ? "department" : "organization", total: items.length, items, availableTypes: APPROVAL_TYPES };
}

async function reviewApproval(user, args = {}) {
  assertReviewer(user);
  const type = normalizeApprovalType(args.type);
  const requestId = String(args.requestId || "").trim();
  const status = String(args.status || "").toUpperCase();
  if (!requestId) throw fail("A request ID is required. First ask me for the pending approval list.");
  if (![
    "APPROVED",
    "REJECTED",
  ].includes(status)) throw fail("Status must be APPROVED or REJECTED.");
  if (status === "REJECTED" && !String(args.reviewNote || "").trim()) throw fail("A rejection reason is required.");
  if (args.confirmation !== "CONFIRM") return { requiresConfirmation: true, type, requestId, status, message: `I found a ${type} request ${requestId}. Reply CONFIRM to ${status === "APPROVED" ? "approve" : "reject"} this one request.` };

  const organizationId = user.organizationId;
  const reviewNote = String(args.reviewNote || "").trim().slice(0, 1000) || undefined;
  let result;
  if (type === "LEAVE") result = await leaveService.reviewLeaveRequest(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "LEAVE_DATE_CHANGE") result = await leaveService.reviewLeaveDateChange(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "SHOOT_REQUEST") result = await shootRequestService.review(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "SHOOT_CANCELLATION") result = await shootRequestService.reviewCancellation(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "SHOOT_SETTLEMENT") result = await shootSettlementService.review(requestId, organizationId, user.id, user.role, { status, reviewNote, approvedShootMinutes: args.approvedShootMinutes, approvedAllowanceAmount: args.approvedAllowanceAmount, approvedExpenseAmount: args.approvedExpenseAmount });
  else if (type === "SHOOT_SETTLEMENT_OVERTIME") result = await shootSettlementService.reviewOvertime(requestId, organizationId, user.id, user.role, { kind: args.kind, status, reviewNote, approvedShootOtMinutes: args.approvedShootOtMinutes, approvedTravelOtMinutes: args.approvedTravelOtMinutes, approvedTravelOtAmount: args.approvedTravelOtAmount });
  else if (type === "WORK_FROM_HOME") result = await workFromHomeService.reviewRequest(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "OVERTIME") result = await overtimeService.reviewOvertimeRequest(organizationId, requestId, user.id, { status, approvedMinutes: args.approvedMinutes, reviewNote, reviewerRole: user.role });
  else if (type === "EXPENSE") result = await expenseService.reviewExpenseClaim(organizationId, requestId, user.id, { status, reviewNote, reviewerRole: user.role });
  else if (type === "ATTENDANCE_CORRECTION") result = await correctionService.reviewRequest(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "PERMISSION") result = await permissionService.review(organizationId, requestId, { status, note: reviewNote }, { id: user.id, role: user.role });
  else if (type === "DAY_OFF_WORK") result = await dayOffWorkService.reviewRequest(requestId, organizationId, user.id, { status, reviewNote }, user.role);
  else if (type === "COMP_OFF") result = await compOffService.reviewRedemption(organizationId, requestId, user.id, { status, reviewNote, reviewerRole: user.role });
  else if (type === "LOAN") result = await loanService.review(organizationId, requestId, { status, reviewNote, monthlyRecovery: args.monthlyRecovery }, user.id, user.role);

  return { action: "REVIEW", type, requestId, status, result };
}

module.exports = { APPROVAL_TYPES, REVIEWER_ROLES, normalizeApprovalType, getPendingApprovals, reviewApproval };
