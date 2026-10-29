const prisma = require("../config/database");
const { WORKING_STATUSES } = require("../utils/employeeStatus");
const webPushService = require("./web-push.service");

const MANAGE_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER"];
const ADMIN_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const MAX_NOTIFY = 2000;

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
};

const canManage = (role) => MANAGE_ROLES.includes(role);

const cleanText = (label, value, max) => {
  const text = String(value ?? "").trim();
  if (!text) fail(`${label} is required.`);
  if (text.length > max) fail(`${label} must be ${max} characters or fewer.`);
  return text;
};

/** undefined = leave unchanged, null/"" = never expires, otherwise a future date. */
const parseExpiry = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail("Enter a valid expiry date.");
  if (date.getTime() <= Date.now()) fail("The expiry date must be in the future.");
  return date;
};

const withState = (row, now = new Date()) => ({
  ...row,
  isExpired: Boolean(row.expiresAt && new Date(row.expiresAt) <= now),
});

/** Everyone sees live posts; HR and admins also see expired ones so they can renew or remove them. */
async function list(organizationId, user) {
  const now = new Date();
  const where = { organizationId };
  if (!canManage(user.role)) where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];
  const rows = await prisma.announcement.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  return rows.map((row) => withState(row, now));
}

async function notifyEveryone(organizationId, authorUserId, title) {
  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        id: { not: authorUserId },
        employee: { is: { status: { in: WORKING_STATUSES } } },
      },
      select: { id: true },
      take: MAX_NOTIFY,
    });
    if (!users.length) return 0;
    const result = await prisma.notification.createMany({
      data: users.map((u) => ({
        organizationId,
        userId: u.id,
        title: "New announcement",
        message: title,
        type: "ANNOUNCEMENT",
      })),
    });
    void webPushService.sendToUsers(users.map((u) => ({ userId: u.id, title: "New announcement", message: title, type: "ANNOUNCEMENT" })));
    return result.count;
  } catch (error) {
    // The post itself is what matters; a failed fan-out must not undo it.
    console.warn("[Announcement] Notification fan-out failed:", error.message);
    return 0;
  }
}

async function create(organizationId, user, payload = {}) {
  if (!canManage(user.role)) fail("Only HR or an admin can post announcements.", 403);
  const title = cleanText("Title", payload.title, MAX_TITLE);
  const body = cleanText("Message", payload.body, MAX_BODY);
  const expiresAt = parseExpiry(payload.expiresAt);

  const created = await prisma.announcement.create({
    data: {
      organizationId,
      title,
      body,
      pinned: payload.pinned === true,
      expiresAt: expiresAt ?? null,
      createdByUserId: user.id,
    },
  });
  const notified = payload.notify === false ? 0 : await notifyEveryone(organizationId, user.id, title);
  return { ...withState(created), notified };
}

async function findEditable(organizationId, user, id) {
  if (!canManage(user.role)) fail("Only HR or an admin can change announcements.", 403);
  const existing = await prisma.announcement.findFirst({ where: { id, organizationId } });
  if (!existing) fail("Announcement not found.", 404);
  // HR can manage their own posts; changing someone else's needs an admin.
  if (!ADMIN_ROLES.includes(user.role) && existing.createdByUserId !== user.id) {
    fail("You can only change announcements you posted.", 403);
  }
  return existing;
}

async function update(organizationId, user, id, payload = {}) {
  await findEditable(organizationId, user, id);
  const expiresAt = parseExpiry(payload.expiresAt);
  const updated = await prisma.announcement.update({
    where: { id },
    data: {
      ...(payload.title !== undefined ? { title: cleanText("Title", payload.title, MAX_TITLE) } : {}),
      ...(payload.body !== undefined ? { body: cleanText("Message", payload.body, MAX_BODY) } : {}),
      ...(payload.pinned !== undefined ? { pinned: payload.pinned === true } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    },
  });
  return withState(updated);
}

async function remove(organizationId, user, id) {
  await findEditable(organizationId, user, id);
  await prisma.announcement.delete({ where: { id } });
  return { success: true };
}

module.exports = { list, create, update, remove, canManage };
