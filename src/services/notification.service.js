const prisma = require("../config/database");
const { WORKING_STATUSES } = require("../utils/employeeStatus");
const { withRedisLock } = require("../config/redis");
const { runIfLeader } = require("../utils/jobLease");
const { processDueDeliveries } = require("./webhook.service");
const { sendSubscriptionReminders } = require("./subscriptionReminder.service");
const emailService = require("./email.service");
const { requiresAdminReview, ADMIN_ROLES } = require("../utils/approvalChain");
const whatsappService = require("./whatsapp.service");
const webPushService = require("./web-push.service");
const { getLocalDateOnly, getLocalMinutesOfDay } = require("../utils/datetime");
const {
  FALLBACK_TZ,
  clockMinutes,
  zoneOf,
  isWorkingDay,
  isBeforeShiftStartWindow,
  isAfterShiftEndWindow,
} = require("../utils/reminderWindows");

const END_OF_DAY_MINUTES = 23 * 60;
const isEndOfDay = (now, timeZone) => getLocalMinutesOfDay(now, timeZone) >= END_OF_DAY_MINUTES;

/**
 * Ids of the given due employees who are on approved leave, or whose branch (or whole company) has a
 * holiday, on their own local "today". They are not expected to punch, so they get no reminder.
 */
async function offTodayIds(due) {
  if (due.length === 0) return new Set();
  const employeeIds = due.map((d) => d.emp.id);
  const orgIds = [...new Set(due.map((d) => d.emp.organizationId))];
  const days = [...new Map(due.map((d) => [d.startOfToday.getTime(), d.startOfToday])).values()];
  const earliest = new Date(Math.min(...days.map((d) => d.getTime())));
  const latest = new Date(Math.max(...days.map((d) => d.getTime())));

  const [leaves, holidays, companyLeaves] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "APPROVED", startDate: { lte: latest }, endDate: { gte: earliest } },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    prisma.holiday.findMany({
      where: { organizationId: { in: orgIds }, date: { gte: earliest, lte: latest }, isOptional: false },
      select: { organizationId: true, branchId: true, date: true },
    }),
    prisma.companyLeave.findMany({
      where: { organizationId: { in: orgIds }, startDate: { lte: latest }, endDate: { gte: earliest } },
      select: { organizationId: true, branchId: true, startDate: true, endDate: true },
    }),
  ]);

  const off = new Set();
  for (const { emp, startOfToday } of due) {
    const day = startOfToday.getTime();
    const onLeave = leaves.some((l) => l.employeeId === emp.id && l.startDate.getTime() <= day && l.endDate.getTime() >= day);
    const holiday = holidays.some(
      (h) => h.organizationId === emp.organizationId && h.date.getTime() === day && (!h.branchId || h.branchId === emp.branchId),
    );
    const companyLeave = companyLeaves.some(
      (c) => c.organizationId === emp.organizationId && c.startDate.getTime() <= day && c.endDate.getTime() >= day && (!c.branchId || c.branchId === emp.branchId),
    );
    if (onLeave || holiday || companyLeave) off.add(emp.id);
  }
  return off;
}

class NotificationService {
  /**
   * Create an in-app notification for a user
   */
  async createNotification({ organizationId, userId, title, message, type = "SYSTEM" }) {
    const notification = await prisma.notification.create({
      data: {
        organizationId,
        userId,
        title,
        message,
        type,
      },
    });
    void webPushService.sendToUser({ userId, title, message, type, notificationId: notification.id }).catch((error) => {
      console.warn("[WebPush] Notification delivery failed:", error.message);
    });
    return notification;
  }

  /**
   * Send one in-app notification to every active user in the organization.
   */
  async broadcastToOrganization(organizationId, { title, message, type = "SYSTEM" }) {
    const users = await prisma.user.findMany({
      where: { organizationId, isActive: true },
      select: { id: true },
    });
    if (users.length === 0) return { sent: 0 };

    const result = await prisma.notification.createMany({
      data: users.map((user) => ({ organizationId, userId: user.id, title, message, type })),
    });
    void webPushService.sendToUsers(users.map((user) => ({ userId: user.id, title, message, type })));
    return { sent: result.count };
  }

  /**
   * Tell the people who can act on a request that it is waiting, the moment an employee submits it.
   *
   * Follows the approval chain: a request from an employee goes to HR and the admins; a request from HR or
   * an admin goes to the admins only, because they alone may approve it. The requester is never told
   * about their own request. Never throws: a failed alert must not fail the request that was saved.
   *
   * @returns {Promise<number>} how many people were notified
   */
  async notifyReviewersOfRequest({ organizationId, employeeId, title, summary, type = "APPROVAL" }) {
    try {
      const employee = await prisma.employee.findFirst({
        where: { id: employeeId, organizationId },
        select: { firstName: true, lastName: true, employeeCode: true, userId: true, user: { select: { role: true } } },
      });
      if (!employee) return 0;

      const roles = requiresAdminReview(employee.user?.role) ? ADMIN_ROLES : [...ADMIN_ROLES, "MANAGER"];
      const where = { organizationId, isActive: true, role: { in: roles } };
      if (employee.userId) where.id = { not: employee.userId };
      const reviewers = await prisma.user.findMany({ where, select: { id: true }, take: 200 });
      if (!reviewers.length) return 0;

      const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "An employee";
      const who = employee.employeeCode ? `${name} (${employee.employeeCode})` : name;
      await prisma.notification.createMany({
        data: reviewers.map((reviewer) => ({
          organizationId,
          userId: reviewer.id,
          title,
          message: `${who} ${summary}`,
          type,
        })),
      });
      void webPushService.sendToUsers(reviewers.map((reviewer) => ({ userId: reviewer.id, title, message: `${who} ${summary}`, type })));
      return reviewers.length;
    } catch (error) {
      console.warn("[ReviewerNotification] Could not notify reviewers:", error.message);
      return 0;
    }
  }

  async notifyPauseObservers({ organizationId, employeeId, title, summary, type = "ATTENDANCE" }) {
    try {
      const employee = await prisma.employee.findFirst({
        where: { id: employeeId, organizationId },
        select: { userId: true, firstName: true, lastName: true, employeeCode: true },
      });
      if (!employee) return 0;
      const observers = await prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          role: { in: ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "HR"] },
          ...(employee.userId ? { id: { not: employee.userId } } : {}),
        },
        select: { id: true },
        take: 500,
      });
      if (!observers.length) return 0;
      const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "An employee";
      const who = employee.employeeCode ? `${name} (${employee.employeeCode})` : name;
      const message = `${who} ${summary}`;
      await prisma.notification.createMany({ data: observers.map((observer) => ({ organizationId, userId: observer.id, title, message, type })) });
      void webPushService.sendToUsers(observers.map((observer) => ({ userId: observer.id, title, message, type })));
      return observers.length;
    } catch (error) {
      console.warn("[PauseNotification] Could not notify managers, HR and admins:", error.message);
      return 0;
    }
  }

  /**
   * A new chat message alerts the other people in the conversation. One unread alert per conversation,
   * not one per message, so a busy chat does not bury the rest of the bell.
   */
  async notifyChatMessage({ organizationId, threadId, senderUserId, body }) {
    try {
      const [thread, sender] = await Promise.all([
        prisma.chatThread.findFirst({
          where: { id: threadId, organizationId },
          select: { title: true, isDirect: true, members: { select: { userId: true } } },
        }),
        prisma.user.findUnique({
          where: { id: senderUserId },
          select: { email: true, employee: { select: { firstName: true, lastName: true } } },
        }),
      ]);
      if (!thread) return 0;
      const recipients = thread.members.map((member) => member.userId).filter((id) => id !== senderUserId);
      if (!recipients.length) return 0;

      const senderName =
        `${sender?.employee?.firstName || ""} ${sender?.employee?.lastName || ""}`.trim() || sender?.email || "A teammate";
      const title = thread.isDirect ? `New message from ${senderName}` : `${senderName} in ${thread.title || "group chat"}`;

      const alreadyAlerted = await prisma.notification.findMany({
        where: { userId: { in: recipients }, type: "CHAT", isRead: false, title },
        select: { userId: true },
      });
      const skip = new Set(alreadyAlerted.map((n) => n.userId));
      const targets = recipients.filter((id) => !skip.has(id));
      if (!targets.length) return 0;

      const preview = String(body || "").replace(/\s+/g, " ").trim().slice(0, 140);
      await prisma.notification.createMany({
        data: targets.map((userId) => ({ organizationId, userId, title, message: preview, type: "CHAT" })),
      });
      return targets.length;
    } catch (error) {
      console.warn("[ChatNotification] Could not notify recipients:", error.message);
      return 0;
    }
  }

  /**
   * Get notifications for the logged in user
   */
  async getUserNotifications(userId, organizationId) {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId, organizationId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.notification.count({
        where: { userId, organizationId, isRead: false },
      }),
    ]);

    return {
      success: true,
      unreadCount,
      notifications,
    };
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId, userId) {
    return await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId, organizationId) {
    return await prisma.notification.updateMany({
      where: { userId, organizationId, isRead: false },
      data: { isRead: true },
    });
  }

  /** Delete one notification only for its owner. Available to every role. */
  async deleteNotification(notificationId, userId, organizationId) {
    return await prisma.notification.deleteMany({
      where: { id: notificationId, userId, organizationId },
    });
  }

  /** Keep the current month and remove all older notification history. */
  async cleanupOldNotifications() {
    if (typeof prisma.notification.deleteMany !== "function") return 0;
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const result = await prisma.notification.deleteMany({
      where: { createdAt: { lt: startOfMonth } },
    });
    if (result.count > 0) console.log(`[NotificationCleanup] Removed ${result.count} notifications before ${startOfMonth.toISOString()}`);
    return result.count;
  }

  /**
   * 1. Morning Shift Punch-In Reminder (before shift start, e.g. 08:00–09:00)
   * Sends to all active employees who have not clocked in today.
   */
  async sendMorningCheckInReminders(organizationId = null, respectSchedule = false) {
    const whereEmployee = {
      status: { in: WORKING_STATUSES },
      userId: { not: null },
    };
    if (organizationId) {
      whereEmployee.organizationId = organizationId;
    }

    const activeEmployees = await prisma.employee.findMany({
      where: whereEmployee,
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        phone: true,
        organizationId: true,
        branchId: true,
        user: { select: { email: true } },
        shift: { select: { name: true, startTime: true, workingDays: true } },
        organization: { select: { timezone: true, name: true, logoUrl: true } },
      },
    });

    // Single "now" for the whole pass — the loop below used to call `new Date()`
    // per employee, which only drifted the result by however long the loop
    // itself took to run.
    const reminderNow = new Date();

    // In-memory window filter first. Previously every employee issued up to
    // two sequential queries regardless of whether they were even due for a
    // reminder; for most of the day (outside each org's ~1h morning window)
    // that filter now empties `due` and the function returns without
    // touching the database at all.
    const due = [];
    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const timeZone = zoneOf(emp);
      const startMinutes = clockMinutes(emp.shift?.startTime || "09:00");
      if (
        respectSchedule &&
        (!isWorkingDay(emp.shift, reminderNow, timeZone) ||
          !isBeforeShiftStartWindow(reminderNow, startMinutes, timeZone))
      ) {
        continue;
      }
      due.push({ emp, startOfToday: getLocalDateOnly(reminderNow, timeZone) });
    }

    if (due.length === 0) {
      return { success: true, sentCount: 0, sentUsers: [], timestamp: reminderNow.toISOString() };
    }

    const employeeIds = due.map((d) => d.emp.id);
    const userIds = due.map((d) => d.emp.userId);
    const earliestStartOfToday = new Date(Math.min(...due.map((d) => d.startOfToday.getTime())));

    // Two queries cover every candidate, however many there are, instead of
    // up to two per employee.
    const [attendanceToday, candidateNotifications] = await Promise.all([
      prisma.attendance.findMany({
        // Only today onward: without the bound this read every employee's whole attendance history each minute.
        where: { employeeId: { in: employeeIds }, checkIn: { not: null }, date: { gte: earliestStartOfToday } },
        select: { employeeId: true, date: true },
      }),
      prisma.notification.findMany({
        where: {
          userId: { in: userIds },
          title: { contains: "Morning Shift" }, // matches the older "Check-In" title too,
          createdAt: { gte: earliestStartOfToday },
        },
        select: { userId: true, createdAt: true },
      }),
    ]);

    const hasCheckedInByDate = new Set(attendanceToday.map((a) => `${a.employeeId}:${a.date.getTime()}`));
    const notificationsByUser = new Map();
    for (const n of candidateNotifications) {
      const list = notificationsByUser.get(n.userId);
      if (list) list.push(n.createdAt);
      else notificationsByUser.set(n.userId, [n.createdAt]);
    }

    const candidates = due.filter(({ emp, startOfToday }) => {
      if (hasCheckedInByDate.has(`${emp.id}:${startOfToday.getTime()}`)) return false;
      const sentAt = notificationsByUser.get(emp.userId);
      return !sentAt?.some((createdAt) => createdAt >= startOfToday);
    });
    const offToday = await offTodayIds(candidates);
    const toNotify = candidates.filter(({ emp }) => !offToday.has(emp.id));

    if (toNotify.length === 0) {
      return { success: true, sentCount: 0, sentUsers: [], timestamp: reminderNow.toISOString() };
    }

    await prisma.notification.createMany({
      data: toNotify.map(({ emp }) => ({
        organizationId: emp.organizationId,
        userId: emp.userId,
        title: "Morning Shift Punch-In Reminder",
        message: `Good morning, ${emp.firstName}! Shift starts at ${emp.shift?.startTime || "09:00"}. Punch in on time to avoid a late mark.`,
        type: "ATTENDANCE",
      })),
    });

    const sentUsers = [];
    for (const { emp } of toNotify) {
      const shiftTime = emp.shift?.startTime || "09:00";
      const shiftName = emp.shift?.name || "General Morning Shift";

      // Fire-and-forget, same as before: a slow or failing provider must
      // never hold up the reminder pass for everyone behind it in the loop.
      if (emp.user?.email) {
        emailService
          .sendShiftReminderEmail(emp.user.email, emp.firstName, {
            shiftName,
            shiftTime,
            companyName: emp.organization?.name,
            companyLogoUrl: emp.organization?.logoUrl,
          })
          .catch((e) => console.warn(`[MorningReminder:Email] ${e.message}`));
      }
      if (emp.phone) {
        whatsappService
          .sendShiftReminderWhatsApp(emp.phone, emp.firstName, { shiftName, shiftTime })
          .catch((e) => console.warn(`[MorningReminder:WhatsApp] ${e.message}`));
      }
      sentUsers.push(`${emp.firstName} (${emp.userId})`);
    }

    return {
      success: true,
      sentCount: sentUsers.length,
      sentUsers,
      timestamp: reminderNow.toISOString(),
    };
  }

  /**
   * 2. Evening Shift Completion & Punch-Out Reminder (after shift end, e.g. 18:00–22:59)
   * Sends to all active employees who clocked in today but have not yet clocked out.
   */
  async sendEveningCheckOutReminders(organizationId = null, respectSchedule = false) {
    const whereEmployee = {
      status: { in: WORKING_STATUSES },
      userId: { not: null },
    };
    if (organizationId) {
      whereEmployee.organizationId = organizationId;
    }

    const activeEmployees = await prisma.employee.findMany({
      where: whereEmployee,
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        phone: true,
        organizationId: true,
        user: { select: { email: true } },
        shift: { select: { name: true, endTime: true, workingDays: true } },
        organization: { select: { timezone: true, name: true, logoUrl: true } },
      },
    });

    const reminderNow = new Date();

    const due = [];
    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const timeZone = zoneOf(emp);
      const endMinutes = clockMinutes(emp.shift?.endTime || "18:00");
      if (
        respectSchedule &&
        (!isWorkingDay(emp.shift, reminderNow, timeZone) ||
          !isAfterShiftEndWindow(reminderNow, endMinutes, timeZone))
      ) {
        continue;
      }
      due.push({ emp, startOfToday: getLocalDateOnly(reminderNow, timeZone) });
    }

    if (due.length === 0) {
      return { success: true, sentCount: 0, sentUsers: [], timestamp: reminderNow.toISOString() };
    }

    const employeeIds = due.map((d) => d.emp.id);
    const userIds = due.map((d) => d.emp.userId);
    const earliestStartOfToday = new Date(Math.min(...due.map((d) => d.startOfToday.getTime())));

    const [attendanceToday, candidateNotifications] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: employeeIds }, checkIn: { not: null }, date: { gte: earliestStartOfToday } },
        select: { employeeId: true, date: true, checkOut: true },
      }),
      prisma.notification.findMany({
        where: {
          userId: { in: userIds },
          title: { contains: "Shift Completion" },
          createdAt: { gte: earliestStartOfToday },
        },
        select: { userId: true, createdAt: true },
      }),
    ]);

    const attendanceByEmployeeDate = new Map(attendanceToday.map((a) => [`${a.employeeId}:${a.date.getTime()}`, a]));
    const notificationsByUser = new Map();
    for (const n of candidateNotifications) {
      const list = notificationsByUser.get(n.userId);
      if (list) list.push(n.createdAt);
      else notificationsByUser.set(n.userId, [n.createdAt]);
    }

    const toNotify = due.filter(({ emp, startOfToday }) => {
      const attendance = attendanceByEmployeeDate.get(`${emp.id}:${startOfToday.getTime()}`);
      if (!attendance || attendance.checkOut) return false;
      const sentAt = notificationsByUser.get(emp.userId);
      return !sentAt?.some((createdAt) => createdAt >= startOfToday);
    });

    if (toNotify.length === 0) {
      return { success: true, sentCount: 0, sentUsers: [], timestamp: reminderNow.toISOString() };
    }

    await prisma.notification.createMany({
      data: toNotify.map(({ emp }) => ({
        organizationId: emp.organizationId,
        userId: emp.userId,
        title: "Shift Completion & Punch-Out Reminder",
        message: `Great job today, ${emp.firstName}! Working hours ended at ${emp.shift?.endTime || "18:00"}. Punch out to close your shift.`,
        type: "ATTENDANCE",
      })),
    });

    // Same channels as the morning reminder. Fire-and-forget: a slow or failing provider must not hold up the pass.
    for (const { emp } of toNotify) {
      const shiftName = emp.shift?.name || "General Shift";
      const shiftEndTime = emp.shift?.endTime || "18:00";
      if (emp.user?.email) {
        emailService
          .sendShiftEndReminderEmail(emp.user.email, emp.firstName, {
            shiftName,
            shiftEndTime,
            companyName: emp.organization?.name,
            companyLogoUrl: emp.organization?.logoUrl,
          })
          .catch((e) => console.warn(`[EveningReminder:Email] ${e.message}`));
      }
      if (emp.phone) {
        whatsappService
          .sendShiftEndReminderWhatsApp(emp.phone, emp.firstName, { shiftName, shiftEndTime })
          .catch((e) => console.warn(`[EveningReminder:WhatsApp] ${e.message}`));
      }
    }

    const sentUsers = toNotify.map(({ emp }) => `${emp.firstName} (${emp.userId})`);
    return {
      success: true,
      sentCount: sentUsers.length,
      sentUsers,
      timestamp: reminderNow.toISOString(),
    };
  }

  /**
   * Automated Daily Evaluator
   * Called periodically by the backend scheduler, already protected by job lease
   */
  /**
   * The reminders are idempotent (an admin never gets the same message twice), so running again after a
   * restart or a change of leader is harmless. The in-memory day key only avoids doing the sweep every minute.
   */
  async runDailySubscriptionReminders(now = new Date()) {
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < 4 || this._subscriptionSweepDay === dayKey) return null;
    this._subscriptionSweepDay = dayKey;
    try {
      const result = await sendSubscriptionReminders(now);
      if (result.reminded > 0) console.log(`[SubscriptionReminder] Sent ${result.reminded} reminder(s) across ${result.organizations} workspace(s)`);
      return result;
    } catch (err) {
      // Try again on the next tick instead of waiting a whole day.
      this._subscriptionSweepDay = null;
      console.error("[SubscriptionReminder] Sweep failed:", err.message);
      return null;
    }
  }

  /**
   * The evening-before heads-up: "Tomorrow is a holiday for Diwali". Covers holidays and company leave set by
   * admin or HR, goes to everyone in scope as an in-app notification (the same channel as every other
   * reminder), and is sent once per person per event. Runs from 10:00 in each company's own timezone.
   */
  async sendUpcomingHolidayReminders(now = new Date()) {
    const organizations = await prisma.organization.findMany({ select: { id: true, timezone: true } });
    this._holidaySweep = this._holidaySweep || new Map();
    let sent = 0;

    for (const org of organizations) {
      const timeZone = zoneOf({ organization: org });
      if (getLocalMinutesOfDay(now, timeZone) < 10 * 60) continue;
      const today = getLocalDateOnly(now, timeZone);
      if (this._holidaySweep.get(org.id) === today.getTime()) continue;
      const tomorrow = new Date(today.getTime() + 86400000);

      const [holidays, leaves] = await Promise.all([
        prisma.holiday.findMany({
          where: { organizationId: org.id, date: tomorrow, isOptional: false },
          select: { name: true, branchId: true },
        }),
        prisma.companyLeave.findMany({
          // Only the first day of a leave: later days were announced with it.
          where: { organizationId: org.id, startDate: tomorrow },
          select: { title: true, reason: true, branchId: true, isPaid: true, endDate: true },
        }),
      ]);

      const events = [
        ...holidays.map((h) => ({ title: `Holiday tomorrow: ${h.name}`, branchId: h.branchId, body: `Tomorrow is a holiday for ${h.name}. Punch-in is not required.` })),
        ...leaves.map((l) => {
          const days = Math.round((l.endDate.getTime() - tomorrow.getTime()) / 86400000) + 1;
          return {
            title: `Company leave tomorrow: ${l.title}`,
            branchId: l.branchId,
            body: `Tomorrow starts a ${days > 1 ? `${days}-day ` : ""}${l.isPaid ? "paid" : "unpaid"} company leave for ${l.title}.${l.reason ? ` ${l.reason}.` : ""} Punch-in is not required.`,
          };
        }),
      ];

      const dayLabel = tomorrow.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
      for (const event of events) {
        const employees = await prisma.employee.findMany({
          where: {
            organizationId: org.id,
            deletedAt: null,
            userId: { not: null },
            status: { in: WORKING_STATUSES },
            ...(event.branchId ? { branchId: event.branchId } : {}),
          },
          select: { userId: true },
        });
        if (employees.length === 0) continue;
        const userIds = employees.map((e) => e.userId);
        const already = await prisma.notification.findMany({
          where: { userId: { in: userIds }, title: { contains: event.title }, createdAt: { gte: today } },
          select: { userId: true },
        });
        const alreadySent = new Set(already.map((n) => n.userId));
        const fresh = userIds.filter((id) => !alreadySent.has(id));
        if (fresh.length === 0) continue;
        await prisma.notification.createMany({
          data: fresh.map((userId) => ({
            organizationId: org.id,
            userId,
            title: event.title,
            message: `${dayLabel}. ${event.body}`,
            type: "SYSTEM",
          })),
        });
        sent += fresh.length;
      }
      this._holidaySweep.set(org.id, today.getTime());
    }
    return { success: true, sentCount: sent };
  }

  async evaluateScheduledReminders() {
    try {
      await this.cleanupOldNotifications();
      await this.sendUpcomingHolidayReminders();
      await this.sendMorningCheckInReminders(null, true);
      await this.sendEveningCheckOutReminders(null, true);

      // Each organization is marked once its own local day reaches 23:00.
      await this.markAbsentEmployees(null, { endOfDayOnly: true });

      // Trial and plan reminders for company admins: once a day, after 09:30 India time.
      await this.runDailySubscriptionReminders();

      // Process webhook deliveries with exponential backoff
      const processed = await processDueDeliveries(10);
      if (processed > 0) {
        console.log(`[WebhookScheduler] Processed ${processed} due deliveries`);
      }
    } catch (err) {
      console.error("[NotificationScheduler] Error evaluating reminders:", err.message);
    }
  }

  /**
   * 3. EOD Absent Auto-Marking (23:00+)
   * Creates ABSENT attendance records for active employees who never punched in today.
   * Skips employees who are on approved leave or holiday.
   */
  async markAbsentEmployees(organizationId = null, { endOfDayOnly = false } = {}) {
    const now = new Date();
    const whereEmployee = { status: { in: WORKING_STATUSES }, userId: { not: null } };

    if (endOfDayOnly) {
      // Scheduled run: a cheap timezone lookup first, so the employee table is
      // only read while some organization's own local clock is past 23:00.
      const organizations = await prisma.organization.findMany({ select: { id: true, timezone: true } });
      const due = organizations.filter((org) => isEndOfDay(now, zoneOf({ organization: org })));
      if (due.length === 0) return { success: true, markedCount: 0, markedEmployees: [], date: null };
      whereEmployee.organizationId = { in: due.map((org) => org.id) };
    } else if (organizationId) {
      whereEmployee.organizationId = organizationId;
    }

    const activeEmployees = await prisma.employee.findMany({
      where: whereEmployee,
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        shiftId: true,
        firstName: true,
        lastName: true,
        organization: { select: { timezone: true } },
      },
    });

    // "Today" is each organization's own calendar day. Punches are stored under
    // that date, so absences must be written under the same one; the server's
    // clock (UTC on a host, IST on a laptop) must not decide it.
    const byDay = new Map();
    for (const emp of activeEmployees) {
      const day = getLocalDateOnly(now, zoneOf(emp));
      const key = day.toISOString();
      if (!byDay.has(key)) byDay.set(key, { day, employees: [] });
      byDay.get(key).employees.push(emp);
    }

    if (byDay.size === 0) {
      return {
        success: true,
        markedCount: 0,
        markedEmployees: [],
        date: getLocalDateOnly(now, FALLBACK_TZ).toISOString().split("T")[0],
      };
    }

    let markedCount = 0;
    const markedEmployees = [];
    for (const { day, employees } of byDay.values()) {
      const result = await this.markAbsentForDay(day, employees);
      markedCount += result.markedCount;
      markedEmployees.push(...result.markedEmployees);
    }
    const dates = [...byDay.values()].map(({ day }) => day.toISOString().split("T")[0]);
    return { success: true, markedCount, markedEmployees, date: dates[0], dates };
  }

  /**
   * Writes ABSENT / WEEK_OFF rows for the given employees for one calendar day,
   * passed as UTC midnight of that date. All lookups are batched.
   */
  async markAbsentForDay(today, activeEmployees) {
    const employeeIds = activeEmployees.map((e) => e.id);
    const orgIds = [...new Set(activeEmployees.map((e) => e.organizationId))];
    const shiftIds = [...new Set(activeEmployees.map((e) => e.shiftId).filter(Boolean))];

    // Previously up to four sequential queries per employee (existing
    // attendance, holiday, approved leave, shift) — now four queries total,
    // independent of how many employees are platform-wide.
    const [existingToday, holidaysToday, approvedLeavesToday, shifts, companyLeavesToday] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: { in: employeeIds }, date: today },
        select: { employeeId: true },
      }),
      prisma.holiday.findMany({
        where: { organizationId: { in: orgIds }, date: today, isOptional: false },
        select: { organizationId: true, branchId: true },
      }),
      prisma.leaveRequest.findMany({
        where: { employeeId: { in: employeeIds }, status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } },
        select: { employeeId: true },
      }),
      shiftIds.length
        ? prisma.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, workingDays: true } })
        : Promise.resolve([]),
      prisma.companyLeave.findMany({
        where: { organizationId: { in: orgIds }, startDate: { lte: today }, endDate: { gte: today } },
        select: { organizationId: true, branchId: true },
      }),
    ]);

    const hasAttendanceToday = new Set(existingToday.map((a) => a.employeeId));
    const onLeaveToday = new Set(approvedLeavesToday.map((l) => l.employeeId));
    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    // Mirrors the original OR: a holiday row with no branchId covers the
    // whole organization; one with a branchId covers only that branch.
    const orgWideHoliday = new Set(holidaysToday.filter((h) => !h.branchId).map((h) => h.organizationId));
    const branchHoliday = new Set(holidaysToday.filter((h) => h.branchId).map((h) => `${h.organizationId}:${h.branchId}`));
    // Company leave (for example Diwali) works like a holiday: nobody it covers is marked absent.
    const orgWideLeave = new Set(companyLeavesToday.filter((c) => !c.branchId).map((c) => c.organizationId));
    const branchLeave = new Set(companyLeavesToday.filter((c) => c.branchId).map((c) => `${c.organizationId}:${c.branchId}`));
    const isHolidayFor = (emp) =>
      orgWideHoliday.has(emp.organizationId) ||
      orgWideLeave.has(emp.organizationId) ||
      Boolean(emp.branchId && (branchHoliday.has(`${emp.organizationId}:${emp.branchId}`) || branchLeave.has(`${emp.organizationId}:${emp.branchId}`)));

    const dayOfWeek = today.getUTCDay(); // 0=Sun, 1=Mon... (today is UTC midnight of the local date)
    const weekOffRecords = [];
    const absentRecords = [];
    const markedEmployees = [];

    for (const emp of activeEmployees) {
      if (hasAttendanceToday.has(emp.id)) continue; // Already marked (PRESENT, ON_LEAVE, HOLIDAY, etc.)
      if (isHolidayFor(emp)) continue; // Holiday — skip
      if (onLeaveToday.has(emp.id)) continue; // On leave — skip

      const shift = emp.shiftId ? shiftById.get(emp.shiftId) : null;
      if (shift?.workingDays) {
        const workingDays = shift.workingDays.split(",").map((d) => parseInt(d.trim(), 10));
        if (!workingDays.includes(dayOfWeek)) {
          weekOffRecords.push({
            organizationId: emp.organizationId,
            employeeId: emp.id,
            branchId: emp.branchId || null,
            shiftId: emp.shiftId || null,
            date: today,
            status: "WEEK_OFF",
            workingMinutes: 0,
          });
          continue; // Week-off — skip marking absent
        }
      }

      absentRecords.push({
        organizationId: emp.organizationId,
        employeeId: emp.id,
        branchId: emp.branchId || null,
        shiftId: emp.shiftId || null,
        date: today,
        status: "ABSENT",
        workingMinutes: 0,
      });
      markedEmployees.push(`${emp.firstName} ${emp.lastName || ""}`.trim());
    }

    // skipDuplicates absorbs the same race the original try/catch ignored: a
    // punch landing between the reads above and this write.
    const [, absentResult] = await Promise.all([
      weekOffRecords.length
        ? prisma.attendance.createMany({ data: weekOffRecords, skipDuplicates: true }).catch((err) =>
            console.warn("[markAbsent] Failed to create WEEK_OFF records:", err.message),
          )
        : null,
      absentRecords.length
        ? prisma.attendance.createMany({ data: absentRecords, skipDuplicates: true }).catch((err) => {
            console.error("[AbsentMarker] Failed to create ABSENT records:", err.message);
            return { count: 0 };
          })
        : { count: 0 },
    ]);

    const markedCount = absentResult?.count ?? 0;
    console.log(`[AbsentMarker] Marked ${markedCount} employees ABSENT for ${today.toISOString().split("T")[0]}`);
    return { markedCount, markedEmployees };
  }

  /**
   * Start the recurring 60-second timer
   */
  startScheduler() {
    console.log("[NotificationScheduler] Starting scheduler: punch-in before shift start, punch-out after shift end, absent marking after 23:00...");
    // Every instance may run this timer. The database lease makes exactly one
    // of them the leader, with or without Redis; a dead leader's lease expires
    // after 90s and another instance takes over.
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await runIfLeader("scheduled-reminders", 90_000, () => this.evaluateScheduledReminders());
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 5000);
    setInterval(tick, 60000);
  }
}

module.exports = new NotificationService();
