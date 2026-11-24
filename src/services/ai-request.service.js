const prisma = require("../config/database");
const leaveService = require("./leave.service");
const permissionService = require("./permission.service");

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

const normalized = (value) => clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function getLeaveTypes(user) {
  const rows = await prisma.leaveType.findMany({
    where: { organizationId: user.organizationId, isActive: true },
    select: { id: true, name: true, code: true, isPaid: true, daysAllowed: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

async function resolveLeaveType(user, value) {
  const requested = normalized(value);
  if (!requested) throw fail("Tell me the leave type, for example Casual Leave or CL.");
  const rows = await getLeaveTypes(user);
  const match = rows.find((row) => normalized(row.name) === requested || normalized(row.code) === requested);
  if (!match) return { rows };
  return { match, rows };
}

async function applyLeave(user, args = {}) {
  const resolved = await resolveLeaveType(user, args.leaveType);
  if (!resolved.match) return { requiresLeaveTypeChoice: true, availableLeaveTypes: resolved.rows, message: "I could not match that leave type. Choose one of the available leave types and send it again." };
  const startDate = clean(args.startDate, 32);
  const endDate = clean(args.endDate || args.startDate, 32);
  const reason = clean(args.reason);
  if (!startDate || !endDate || reason.length < 3) throw fail("Leave date, end date, and a reason are required.");
  const preview = { requestType: "LEAVE", employee: "self", leaveType: { id: resolved.match.id, name: resolved.match.name, code: resolved.match.code }, startDate, endDate, totalDays: args.totalDays ?? null, halfDayPeriod: args.halfDayPeriod || null, reason };
  if (args.confirmation !== "CONFIRM") return { requiresConfirmation: true, preview, message: `I am ready to submit this leave request for ${startDate} to ${endDate}. Reply CONFIRM to submit it.` };
  const request = await leaveService.createLeaveRequest(user.id, user.organizationId, { leaveTypeId: resolved.match.id, startDate, endDate, totalDays: args.totalDays, halfDayPeriod: args.halfDayPeriod, reason }, user.role);
  return { submitted: true, requestType: "LEAVE", message: "Leave request submitted for approval.", request };
}

async function applyPermission(user, args = {}) {
  const date = clean(args.date, 32);
  const reason = clean(args.reason);
  const startTime = args.startTime ? clean(args.startTime, 5) : undefined;
  const endTime = args.endTime ? clean(args.endTime, 5) : undefined;
  const hours = args.hours === undefined || args.hours === null ? undefined : Number(args.hours);
  if (!date || reason.length < 3) throw fail("Permission date and a reason are required.");
  if ((!startTime || !endTime) && !(Number.isFinite(hours) && hours > 0)) throw fail("Give either start and end time or the number of permission hours.");
  const preview = { requestType: "PERMISSION", employee: "self", date, startTime: startTime || null, endTime: endTime || null, hours: hours ?? null, reason };
  if (args.confirmation !== "CONFIRM") return { requiresConfirmation: true, preview, message: `I am ready to submit this permission request for ${date}. Reply CONFIRM to submit it.` };
  const request = await permissionService.apply(user.organizationId, user.id, { date, startTime, endTime, hours, reason });
  return { submitted: true, requestType: "PERMISSION", message: "Permission request submitted for approval.", request };
}

module.exports = { getLeaveTypes, applyLeave, applyPermission };
