const crypto = require("node:crypto");
const prisma = require("../config/database");
const notificationService = require("./notification.service");

const MANAGE_ROLES = ["SUPER_ADMIN", "DEVELOPER", "COMPANY_ADMIN", "MANAGER", "HR"];
const SUPPORT_ROLES = ["SUPER_ADMIN", "DEVELOPER", "COMPANY_ADMIN", "MANAGER", "HR"];
const CATEGORIES = ["ATTENDANCE", "PAYROLL", "PROFILE", "LEAVE", "EMPLOYEE", "CHAT", "BILLING", "BUG", "OTHER"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_USER", "RESOLVED", "CLOSED"];
const MAX_TICKETS = 100;

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const clean = (label, value, max, required = true) => {
  const text = String(value ?? "").trim();
  if (required && !text) fail(`${label} is required.`);
  if (text.length > max) fail(`${label} must be ${max} characters or fewer.`);
  return text;
};

const validEnum = (label, value, values, fallback) => {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!values.includes(normalized)) fail(`${label} is not valid.`);
  return normalized;
};

const canManage = (role) => MANAGE_ROLES.includes(role);
const canSupport = (role) => SUPPORT_ROLES.includes(role);

const personName = (user) => {
  const employeeName = `${user?.employee?.firstName || ""} ${user?.employee?.lastName || ""}`.trim();
  return employeeName || user?.email || "Workspace user";
};

const userSelect = {
  id: true,
  email: true,
  role: true,
  employee: { select: { firstName: true, lastName: true, employeeCode: true } },
};

const ticketInclude = {
  organization: { select: { id: true, name: true } },
  requester: { select: userSelect },
  assignedTo: { select: userSelect },
  messages: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: userSelect } },
  },
};

function serializeMessage(message) {
  return {
    id: message.id,
    body: message.body,
    isInternal: message.isInternal,
    createdAt: message.createdAt,
    author: message.author
      ? { id: message.author.id, name: personName(message.author), email: message.author.email, role: message.author.role }
      : null,
  };
}

function serializeTicket(ticket, includeInternal = false) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    sourcePage: ticket.sourcePage,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    organization: ticket.organization ? { id: ticket.organization.id, name: ticket.organization.name } : null,
    requester: ticket.requester
      ? { id: ticket.requester.id, name: personName(ticket.requester), email: ticket.requester.email, role: ticket.requester.role }
      : null,
    assignedTo: ticket.assignedTo
      ? { id: ticket.assignedTo.id, name: personName(ticket.assignedTo), email: ticket.assignedTo.email, role: ticket.assignedTo.role }
      : null,
    messages: (ticket.messages || [])
      .filter((message) => includeInternal || !message.isInternal)
      .map(serializeMessage),
  };
}

function makeReference() {
  return `SUP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function notifyUsers(organizationId, userIds, title, message) {
  const ids = [...new Set(userIds.filter(Boolean))];
  await Promise.all(ids.map((userId) => notificationService.createNotification({
    organizationId,
    userId,
    title,
    message,
    type: "SUPPORT",
  }).catch((error) => {
    console.warn("[Support] Notification failed:", error.message);
    return null;
  })));
}

async function supportAgents(organizationId, excludeId) {
  const users = await prisma.user.findMany({
    where: { organizationId, isActive: true, role: { in: SUPPORT_ROLES }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
    take: 200,
  });
  return users.map((user) => user.id);
}

async function findTicket(organizationId, id, user, includeMessages = true) {
  const globalAgent = ["SUPER_ADMIN", "DEVELOPER"].includes(user.role);
  const where = { id, ...(globalAgent ? {} : { organizationId }) };
  if (!canManage(user.role)) where.requesterId = user.id;
  const ticket = await prisma.supportTicket.findFirst({
    where,
    ...(includeMessages ? { include: ticketInclude } : {}),
  });
  if (!ticket) fail("Support ticket not found.", 404);
  return ticket;
}

async function list(organizationId, user, query = {}) {
  const queue = query.scope === "queue" && canManage(user.role);
  const status = query.status ? validEnum("Status", query.status, STATUSES) : null;
  const where = {
    ...(["SUPER_ADMIN", "DEVELOPER"].includes(user.role) && queue ? {} : { organizationId }),
    ...(queue ? {} : { requesterId: user.id }),
    ...(status ? { status } : {}),
  };
  const [tickets, counts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: MAX_TICKETS,
      include: { organization: { select: { id: true, name: true } }, requester: { select: userSelect }, assignedTo: { select: userSelect } },
    }),
    prisma.supportTicket.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  return {
    scope: queue ? "queue" : "mine",
    tickets: tickets.map((ticket) => serializeTicket({ ...ticket, messages: [] }, true)),
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
  };
}

async function create(organizationId, user, payload = {}) {
  const subject = clean("Subject", payload.subject, 160);
  const description = clean("Description", payload.description, 5000);
  const category = validEnum("Category", payload.category, CATEGORIES, "OTHER");
  const priority = validEnum("Priority", payload.priority, PRIORITIES, "NORMAL");
  const sourcePage = clean("Source page", payload.sourcePage, 500, false) || null;
  const userAgent = clean("Browser context", payload.userAgent, 500, false) || null;
  const reference = makeReference();

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        reference,
        organizationId,
        requesterId: user.id,
        subject,
        description,
        category,
        priority,
        sourcePage,
        userAgent,
        metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : undefined,
      },
    });
    await tx.supportMessage.create({
      data: { organizationId, ticketId: created.id, authorId: user.id, body: description },
    });
    return created;
  });

  const agents = await supportAgents(organizationId, user.id);
  await notifyUsers(organizationId, agents, `New support ticket ${reference}`, subject);
  return serializeTicket(await findTicket(organizationId, ticket.id, user), true);
}

async function reply(organizationId, user, id, payload = {}) {
  const ticket = await findTicket(organizationId, id, user);
  const body = clean("Reply", payload.body, 5000);
  const isInternal = payload.isInternal === true && canManage(user.role);
  const message = await prisma.supportMessage.create({
    data: { organizationId, ticketId: ticket.id, authorId: user.id, body, isInternal },
    include: { author: { select: userSelect } },
  });

  const update = {};
  if (!isInternal && !canManage(user.role) && ticket.status === "WAITING_ON_USER") update.status = "IN_PROGRESS";
  if (!isInternal && canManage(user.role) && !ticket.firstResponseAt) update.firstResponseAt = new Date();
  if (Object.keys(update).length) await prisma.supportTicket.update({ where: { id: ticket.id }, data: update });

  if (canManage(user.role)) {
    await notifyUsers(organizationId, [ticket.requesterId], `Reply on ${ticket.reference}`, body.slice(0, 180));
  } else {
    const recipients = ticket.assignedToId ? [ticket.assignedToId] : await supportAgents(organizationId, user.id);
    await notifyUsers(organizationId, recipients, `Customer reply on ${ticket.reference}`, body.slice(0, 180));
  }
  return serializeMessage(message);
}

async function update(organizationId, user, id, payload = {}) {
  if (!canManage(user.role)) fail("Only HR, managers, or admins can manage support tickets.", 403);
  const ticket = await findTicket(organizationId, id, user);
  const data = {};
  if (payload.status !== undefined) data.status = validEnum("Status", payload.status, STATUSES);
  if (payload.priority !== undefined) data.priority = validEnum("Priority", payload.priority, PRIORITIES);
  if (payload.assignedToId !== undefined) {
    if (payload.assignedToId === null || payload.assignedToId === "") {
      data.assignedToId = null;
    } else {
      const assignee = await prisma.user.findFirst({ where: { id: String(payload.assignedToId), isActive: true, role: { in: ["DEVELOPER", "COMPANY_ADMIN", "MANAGER", "HR"] }, ...(["SUPER_ADMIN", "DEVELOPER"].includes(user.role) ? {} : { organizationId }) } });
      if (!assignee) fail("The selected assignee is not an active support user.");
      data.assignedToId = assignee.id;
    }
  }
  if (data.status === "RESOLVED") data.resolvedAt = new Date();
  if (data.status === "CLOSED") data.closedAt = new Date();
  if (data.status && data.status !== "RESOLVED") data.resolvedAt = null;
  if (data.status && data.status !== "CLOSED") data.closedAt = null;
  if (!Object.keys(data).length) fail("No support ticket changes were provided.");
  const updated = await prisma.supportTicket.update({ where: { id: ticket.id }, data, include: ticketInclude });
  if (updated.assignedToId && updated.assignedToId !== ticket.assignedToId) {
    await notifyUsers(organizationId, [updated.assignedToId], `Ticket assigned: ${updated.reference}`, updated.subject);
  }
  if (data.status && data.status !== ticket.status) {
    await notifyUsers(organizationId, [ticket.requesterId], `${updated.reference} is ${updated.status.replaceAll("_", " ").toLowerCase()}`, updated.subject);
  }
  return serializeTicket(updated, true);
}

async function close(organizationId, user, id) {
  const ticket = await findTicket(organizationId, id, user, false);
  if (ticket.requesterId !== user.id && !canManage(user.role)) fail("You cannot close this ticket.", 403);
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { status: "CLOSED", closedAt: new Date() },
    include: ticketInclude,
  });
  if (canManage(user.role) && ticket.requesterId !== user.id) await notifyUsers(organizationId, [ticket.requesterId], `${ticket.reference} was closed`, ticket.subject);
  return serializeTicket(updated, canManage(user.role));
}

module.exports = { list, create, findTicket, reply, update, close, canManage };
