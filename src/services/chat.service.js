const prisma = require("../config/database");
const { parsePagination, paginationMeta } = require("../utils/pagination");
const { broadcastToThread } = require("../realtime/chatWs");

async function listThreads(organizationId, userId, query = {}) {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 100 });
  const where = { userId, thread: { organizationId } };
  const [memberships, total] = await Promise.all([
    prisma.chatMember.findMany({
      where,
      skip,
      take: limit,
      include: {
        thread: {
          include: {
            members: {
              include: { user: { select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } } } },
            },
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: { thread: { updatedAt: "desc" } },
    }),
    prisma.chatMember.count({ where }),
  ]);
  const records = memberships.map((m) => m.thread);
  return { records, ...paginationMeta(total, page, limit) };
}

async function openDirect(organizationId, userId, otherUserId) {
  if (!otherUserId || otherUserId === userId) {
    const err = new Error("Pick another teammate");
    err.statusCode = 400;
    throw err;
  }
  const other = await prisma.user.findFirst({ where: { id: otherUserId, organizationId } });
  if (!other) {
    const err = new Error("User not found in this organization");
    err.statusCode = 404;
    throw err;
  }
  const existing = await prisma.chatThread.findFirst({
    where: {
      organizationId,
      isDirect: true,
      AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherUserId } } }],
    },
    include: { members: true },
  });
  if (existing && existing.members.length === 2) return existing;

  return prisma.chatThread.create({
    data: {
      organizationId,
      isDirect: true,
      title: null,
      members: { create: [{ userId }, { userId: otherUserId }] },
    },
  });
}

async function getMessages(organizationId, userId, threadId, query = {}) {
  const member = await prisma.chatMember.findFirst({
    where: { threadId, userId, thread: { organizationId } },
  });
  if (!member) {
    const err = new Error("Not a member of this thread");
    err.statusCode = 403;
    throw err;
  }
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 200 });
  const where = { threadId, organizationId };
  const [messages, total] = await Promise.all([
    prisma.chatMessage.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.chatMessage.count({ where }),
  ]);
  return { records: messages, ...paginationMeta(total, page, limit) };
}

async function sendMessage(organizationId, userId, threadId, body) {
  const text = String(body || "").trim();
  if (!text) {
    const err = new Error("Message is required");
    err.statusCode = 400;
    throw err;
  }
  const member = await prisma.chatMember.findFirst({
    where: { threadId, userId, thread: { organizationId } },
  });
  if (!member) {
    const err = new Error("Not a member of this thread");
    err.statusCode = 403;
    throw err;
  }
  const message = await prisma.chatMessage.create({
    data: { organizationId, threadId, senderUserId: userId, body: text.slice(0, 4000) },
    include: {
      sender: { select: { id: true, email: true, employee: { select: { firstName: true, lastName: true } } } },
    },
  });
  await prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });

  // Push to live subscribers (no-op when the WebSocket gateway is not attached).
  broadcastToThread(threadId, message);
  return message;
}

async function createGroup(organizationId, userId, { title, userIds }) {
  const name = String(title || "").trim();
  if (!name) {
    const err = new Error("Group title is required");
    err.statusCode = 400;
    throw err;
  }
  const ids = Array.from(new Set([userId, ...(Array.isArray(userIds) ? userIds : [])]));
  const members = await prisma.user.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true },
  });
  if (members.length < 2) {
    const err = new Error("Add at least one teammate");
    err.statusCode = 400;
    throw err;
  }
  return prisma.chatThread.create({
    data: {
      organizationId,
      isDirect: false,
      title: name,
      members: { create: members.map((m) => ({ userId: m.id })) },
    },
    include: { members: { include: { user: { select: { id: true, email: true } } } } },
  });
}

async function listTeammates(organizationId, userId, query = {}) {
  const { page, limit, skip } = parsePagination(query, { defaultLimit: 100 });
  const where = { organizationId, isActive: true, id: { not: userId } };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        role: true,
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { records: users, ...paginationMeta(total, page, limit) };
}

module.exports = { listThreads, openDirect, createGroup, getMessages, sendMessage, listTeammates };
