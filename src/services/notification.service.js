const prisma = require("../config/database");
const emailService = require("./email.service");
const whatsappService = require("./whatsapp.service");

const clockMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

const isWorkingDay = (shift, now) => String(shift?.workingDays || "1,2,3,4,5,6")
  .split(",").map((day) => Number(day.trim())).includes(now.getDay());

const isInReminderWindow = (now, target) => {
  if (target === null) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const delta = (target - current + 1440) % 1440;
  return delta >= 0 && delta <= 10;
};

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
   * 1. Morning Shift Check-In Reminder (8:50 AM - 10 minutes before 9:00 AM)
   * Sends to all active employees who have not clocked in today.
   */
  async sendMorningCheckInReminders(organizationId = null, respectSchedule = false) {
    const startOfToday = this.getStartOfToday();
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
      },
    });

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const reminderNow = new Date();
      if (respectSchedule && (!isWorkingDay(emp.shift, reminderNow) || !isInReminderWindow(reminderNow, clockMinutes(emp.shift?.startTime || "09:00")))) continue;

      // Check if user already clocked in today
      const todayAttendance = await prisma.attendance.findFirst({
        where: {
          employeeId: emp.id,
          date: { gte: startOfToday },
          checkIn: { not: null },
        },
      });

      // If user hasn't clocked in today
      if (!todayAttendance) {
        // Check if morning reminder was already sent today to avoid duplicate spam
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: emp.userId,
            createdAt: { gte: startOfToday },
            title: { contains: "Morning Shift Check-In" },
          },
        });

        if (!existingNotification) {
          const shiftTime = emp.shift?.startTime || "09:00 AM";
          const shiftName = emp.shift?.name || "General Morning Shift";

          await prisma.notification.create({
            data: {
              organizationId: emp.organizationId,
              userId: emp.userId,
              title: "⏰ Morning Shift Check-In Reminder (08:50 AM)",
              message: `Good morning, ${emp.firstName}! Shift starts at ${shiftTime}. Please remember to clock in within the grace period to prevent late marks.`,
              type: "ATTENDANCE",
            },
          });

          // Dispatch Email
          if (emp.user?.email) {
            emailService
              .sendShiftReminderEmail(emp.user.email, emp.firstName, {
                shiftName,
                shiftTime,
              })
              .catch((e) => console.warn(`[MorningReminder:Email] ${e.message}`));
          }

          // Dispatch WhatsApp
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
   * 2. Evening Shift Completion & Check-Out Reminder (After 6:00 PM)
   * Sends to all active employees who clocked in today but have not yet clocked out.
   */
  async sendEveningCheckOutReminders(organizationId = null, respectSchedule = false) {
    const startOfToday = this.getStartOfToday();
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
      },
    });

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;
      const reminderNow = new Date();
      if (respectSchedule && (!isWorkingDay(emp.shift, reminderNow) || !isInReminderWindow(reminderNow, clockMinutes(emp.shift?.endTime || "18:00")))) continue;

      // Find today's attendance record
      const todayAttendance = await prisma.attendance.findFirst({
        where: {
          employeeId: emp.id,
          date: { gte: startOfToday },
          checkIn: { not: null },
        },
      });

      // Check if employee clocked in but has NOT clocked out yet
      if (todayAttendance && !todayAttendance.checkOut) {
        // Check if evening reminder was already sent today
        const existingNotification = await prisma.notification.findFirst({
          where: {
            userId: emp.userId,
            createdAt: { gte: startOfToday },
            title: { contains: "Shift Completion" },
          },
        });

        if (!existingNotification) {
          await prisma.notification.create({
            data: {
              organizationId: emp.organizationId,
              userId: emp.userId,
              title: "🏁 Shift Completion & Check-Out Reminder (06:00 PM)",
              message: `Great job today, ${emp.firstName}! Standard working hours ended at 06:00 PM. Please clock out to finalize your 8-hour shift and prevent missed punch penalties.`,
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
    try {
      const now = new Date();
      // Morning Window: 08:50 – 17:59 → Check-In reminders
      await this.sendMorningCheckInReminders(null, true);

      // Evening Window: 18:00–22:59 → Check-Out reminders
      await this.sendEveningCheckOutReminders(null, true);

      // Nightly Window: 23:00+ → EOD Absent auto-marking
      if (hours >= 23) {
        await this.markAbsentEmployees();
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
    console.log("[NotificationScheduler] Starting scheduler: Morning (08:50), Evening (18:00), Absent marking (23:00)...");
    setTimeout(() => this.evaluateScheduledReminders(), 5000);
    setInterval(() => this.evaluateScheduledReminders(), 60000);
  }
}

module.exports = new NotificationService();
