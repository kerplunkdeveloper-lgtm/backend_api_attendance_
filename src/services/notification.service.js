const prisma = require("../config/database");
const { withRedisLock } = require("../config/redis");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");
const { getLocalDateOnly, getLocalMinutesOfDay } = require("../utils/datetime");
const {
  FALLBACK_TZ,
  clockMinutes,
  zoneOf,
  isWorkingDay,
  isBeforeShiftStartWindow,
  isAfterShiftEndWindow,
} = require("../utils/reminderWindows");

class NotificationService {
  /**
   * Create an in-app notification for a user
   */
  async createNotification({ organizationId, userId, title, message, type = "SYSTEM" }) {
    return await prisma.notification.create({
      data: {
        organizationId,
        userId,
        title,
        message,
        type,
      },
    });
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
    return { sent: result.count };
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

  /**
   * Helper: Get start of today (UTC or local normalized date)
   */
  getStartOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  /**
   * 1. Morning Shift Check-In Reminder (before shift start, e.g. 08:00–09:00)
   * Sends to all active employees who have not clocked in today.
   */
  async sendMorningCheckInReminders(organizationId = null, respectSchedule = false) {
    const whereEmployee = {
      status: "ACTIVE",
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
        where: { employeeId: { in: employeeIds }, checkIn: { not: null } },
        select: { employeeId: true, date: true },
      }),
      prisma.notification.findMany({
        where: {
          userId: { in: userIds },
          title: { contains: "Morning Shift Check-In" },
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

    const toNotify = due.filter(({ emp, startOfToday }) => {
      if (hasCheckedInByDate.has(`${emp.id}:${startOfToday.getTime()}`)) return false;
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
        title: "Morning Shift Check-In Reminder",
        message: `Good morning, ${emp.firstName}! Shift starts at ${emp.shift?.startTime || "09:00"}. Clock in on time to avoid a late mark.`,
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
   * 2. Evening Shift Completion & Check-Out Reminder (after shift end, e.g. 18:00–22:59)
   * Sends to all active employees who clocked in today but have not yet clocked out.
   */
  async sendEveningCheckOutReminders(organizationId = null, respectSchedule = false) {
    const whereEmployee = {
      status: "ACTIVE",
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
        organizationId: true,
        shift: { select: { name: true, endTime: true, workingDays: true } },
        organization: { select: { timezone: true } },
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
        where: { employeeId: { in: employeeIds }, checkIn: { not: null } },
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
        title: "Shift Completion & Check-Out Reminder",
        message: `Great job today, ${emp.firstName}! Working hours ended at ${emp.shift?.endTime || "18:00"}. Clock out to close your shift.`,
        type: "ATTENDANCE",
      })),
    });

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
   * Called periodically by the backend scheduler
   */
  async evaluateScheduledReminders() {
    return withRedisLock("workpulse:jobs:scheduled-reminders", 55000, async () => {
      try {
      const now = new Date();
      const hours = getLocalMinutesOfDay(now, FALLBACK_TZ) / 60;
      await this.sendMorningCheckInReminders(null, true);
      await this.sendEveningCheckOutReminders(null, true);

      if (hours >= 23) {
        await this.markAbsentEmployees();
      }
      } catch (err) {
        console.error("[NotificationScheduler] Error evaluating reminders:", err.message);
      }
    });
  }

  /**
   * 3. EOD Absent Auto-Marking (23:00+)
   * Creates ABSENT attendance records for active employees who never punched in today.
   * Skips employees who are on approved leave or holiday.
   */
  async markAbsentEmployees(organizationId = null) {
    const startOfToday = this.getStartOfToday();
    const today = new Date(startOfToday);
    today.setUTCHours(0, 0, 0, 0);

    const whereEmployee = { status: "ACTIVE", userId: { not: null } };
    if (organizationId) whereEmployee.organizationId = organizationId;

    const activeEmployees = await prisma.employee.findMany({
      where: whereEmployee,
      select: { id: true, organizationId: true, branchId: true, shiftId: true, firstName: true, lastName: true },
    });

    if (activeEmployees.length === 0) {
      return { success: true, markedCount: 0, markedEmployees: [], date: today.toISOString().split("T")[0] };
    }

    const employeeIds = activeEmployees.map((e) => e.id);
    const orgIds = [...new Set(activeEmployees.map((e) => e.organizationId))];
    const shiftIds = [...new Set(activeEmployees.map((e) => e.shiftId).filter(Boolean))];

    // Previously up to four sequential queries per employee (existing
    // attendance, holiday, approved leave, shift) — now four queries total,
    // independent of how many employees are platform-wide.
    const [existingToday, holidaysToday, approvedLeavesToday, shifts] = await Promise.all([
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
    ]);

    const hasAttendanceToday = new Set(existingToday.map((a) => a.employeeId));
    const onLeaveToday = new Set(approvedLeavesToday.map((l) => l.employeeId));
    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    // Mirrors the original OR: a holiday row with no branchId covers the
    // whole organization; one with a branchId covers only that branch.
    const orgWideHoliday = new Set(holidaysToday.filter((h) => !h.branchId).map((h) => h.organizationId));
    const branchHoliday = new Set(holidaysToday.filter((h) => h.branchId).map((h) => `${h.organizationId}:${h.branchId}`));
    const isHolidayFor = (emp) =>
      orgWideHoliday.has(emp.organizationId) || (emp.branchId && branchHoliday.has(`${emp.organizationId}:${emp.branchId}`));

    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
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
    return { success: true, markedCount, markedEmployees, date: today.toISOString().split("T")[0] };
  }

  /**
   * Start the recurring 60-second timer
   */
  startScheduler() {
    console.log("[NotificationScheduler] Starting scheduler: check-in before shift start, check-out after shift end, absent marking after 23:00...");
    setTimeout(() => this.evaluateScheduledReminders(), 5000);
    setInterval(() => this.evaluateScheduledReminders(), 60000);
  }
}

module.exports = new NotificationService();
