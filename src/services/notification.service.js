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
        organization: { select: { timezone: true } },
      },
    });

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const reminderNow = new Date();
      const timeZone = zoneOf(emp);
      const startMinutes = clockMinutes(emp.shift?.startTime || "09:00");
      if (
        respectSchedule &&
        (!isWorkingDay(emp.shift, reminderNow, timeZone) ||
          !isBeforeShiftStartWindow(reminderNow, startMinutes, timeZone))
      ) {
        continue;
      }

      const startOfToday = getLocalDateOnly(reminderNow, timeZone);

      const todayAttendance = await prisma.attendance.findFirst({
        where: {
          employeeId: emp.id,
          date: startOfToday,
          checkIn: { not: null },
        },
      });

      if (!todayAttendance) {
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: emp.userId,
            createdAt: { gte: startOfToday },
            title: { contains: "Morning Shift Check-In" },
          },
        });

        if (!existingNotification) {
          const shiftTime = emp.shift?.startTime || "09:00";
          const shiftName = emp.shift?.name || "General Morning Shift";

          await prisma.notification.create({
            data: {
              organizationId: emp.organizationId,
              userId: emp.userId,
              title: "Morning Shift Check-In Reminder",
              message: `Good morning, ${emp.firstName}! Shift starts at ${shiftTime}. Clock in on time to avoid a late mark.`,
              type: "ATTENDANCE",
            },
          });

          if (emp.user?.email) {
            emailService
              .sendShiftReminderEmail(emp.user.email, emp.firstName, {
                shiftName,
                shiftTime,
              })
              .catch((e) => console.warn(`[MorningReminder:Email] ${e.message}`));
          }

          if (emp.phone) {
            whatsappService
              .sendShiftReminderWhatsApp(emp.phone, emp.firstName, {
                shiftName,
                shiftTime,
              })
              .catch((e) => console.warn(`[MorningReminder:WhatsApp] ${e.message}`));
          }

          sentCount++;
          sentUsers.push(`${emp.firstName} (${emp.userId})`);
        }
      }
    }

    return {
      success: true,
      sentCount,
      sentUsers,
      timestamp: new Date().toISOString(),
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

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const reminderNow = new Date();
      const timeZone = zoneOf(emp);
      const endMinutes = clockMinutes(emp.shift?.endTime || "18:00");
      if (
        respectSchedule &&
        (!isWorkingDay(emp.shift, reminderNow, timeZone) ||
          !isAfterShiftEndWindow(reminderNow, endMinutes, timeZone))
      ) {
        continue;
      }

      const startOfToday = getLocalDateOnly(reminderNow, timeZone);

      const todayAttendance = await prisma.attendance.findFirst({
        where: {
          employeeId: emp.id,
          date: startOfToday,
          checkIn: { not: null },
        },
      });

      if (todayAttendance && !todayAttendance.checkOut) {
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: emp.userId,
            createdAt: { gte: startOfToday },
            title: { contains: "Shift Completion" },
          },
        });

        if (!existingNotification) {
          const endTime = emp.shift?.endTime || "18:00";
          await prisma.notification.create({
            data: {
              organizationId: emp.organizationId,
              userId: emp.userId,
              title: "Shift Completion & Check-Out Reminder",
              message: `Great job today, ${emp.firstName}! Working hours ended at ${endTime}. Clock out to close your shift.`,
              type: "ATTENDANCE",
            },
          });
          sentCount++;
          sentUsers.push(`${emp.firstName} (${emp.userId})`);
        }
      }
    }

    return {
      success: true,
      sentCount,
      sentUsers,
      timestamp: new Date().toISOString(),
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

    let markedCount = 0;
    const markedEmployees = [];

    for (const emp of activeEmployees) {
      // Check if already has any attendance record for today
      const existing = await prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: emp.id, date: today } },
      });

      if (existing) continue; // Already marked (PRESENT, ON_LEAVE, HOLIDAY, etc.)

      // Check if today is a holiday for this employee's branch
      const holiday = await prisma.holiday.findFirst({
        where: {
          organizationId: emp.organizationId,
          date: today,
          isOptional: false,
          OR: [{ branchId: null }, ...(emp.branchId ? [{ branchId: emp.branchId }] : [])],
        },
      });

      if (holiday) continue; // Holiday — skip

      // Check for approved leave
      const approvedLeave = await prisma.leaveRequest.findFirst({
        where: {
          employeeId: emp.id,
          status: "APPROVED",
          startDate: { lte: today },
          endDate: { gte: today },
        },
      });

      if (approvedLeave) continue; // On leave — skip

      // Check if today is a scheduled rest day (WEEK_OFF)
      if (emp.shiftId) {
        const shift = await prisma.shift.findUnique({ where: { id: emp.shiftId } });
        if (shift && shift.workingDays) {
          const workingDays = shift.workingDays.split(",").map((d) => parseInt(d.trim()));
          const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon...
          if (!workingDays.includes(dayOfWeek)) {
            try {
              await prisma.attendance.create({
                data: {
                  organizationId: emp.organizationId,
                  employeeId: emp.id,
                  branchId: emp.branchId || null,
                  shiftId: emp.shiftId || null,
                  date: today,
                  status: "WEEK_OFF",
                  workingMinutes: 0,
                },
              });
            } catch (weekOffErr) {
              console.warn("[markAbsent] Failed to upsert WEEK_OFF record:", weekOffErr.message);
            }
            continue; // Week-off — skip marking absent
          }
        }
      }

      // Mark as ABSENT
      try {
        await prisma.attendance.create({
          data: {
            organizationId: emp.organizationId,
            employeeId: emp.id,
            branchId: emp.branchId || null,
            shiftId: emp.shiftId || null,
            date: today,
            status: "ABSENT",
            workingMinutes: 0,
          },
        });
        markedCount++;
        markedEmployees.push(`${emp.firstName} ${emp.lastName || ""}`.trim());
      } catch (err) {
        // Ignore unique constraint errors (race condition)
        if (!err.message?.includes("Unique constraint")) {
          console.error(`[AbsentMarker] Failed for employee ${emp.id}:`, err.message);
        }
      }
    }

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
