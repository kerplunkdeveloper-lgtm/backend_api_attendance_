const prisma = require("../config/database");

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
  async sendMorningCheckInReminders(organizationId = null) {
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
      },
    });

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;

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
          await prisma.notification.create({
            data: {
              organizationId: emp.organizationId,
              userId: emp.userId,
              title: "⏰ Morning Shift Check-In Reminder (08:50 AM)",
              message: `Good morning, ${emp.firstName}! Shift starts at 09:00 AM. Please remember to clock in within the 15-minute grace period to prevent late marks.`,
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
   * 2. Evening Shift Completion & Check-Out Reminder (After 6:00 PM)
   * Sends to all active employees who clocked in today but have not yet clocked out.
   */
  async sendEveningCheckOutReminders(organizationId = null) {
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
      },
    });

    let sentCount = 0;
    const sentUsers = [];

    for (const emp of activeEmployees) {
      if (!emp.userId) continue;

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
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // Check for Morning Window: Starts 10 minutes before 9:00 AM (08:50 AM) through the morning
      if ((hours === 8 && minutes >= 50) || (hours >= 9 && hours < 18)) {
        await this.sendMorningCheckInReminders();
      }

      // Check for Evening Window: 6:00 PM and later (18:00+)
      if (hours >= 18) {
        await this.sendEveningCheckOutReminders();
      }
    } catch (err) {
      console.error("[NotificationScheduler] Error evaluating reminders:", err.message);
    }
  }

  /**
   * Start the recurring 60-second timer
   */
  startScheduler() {
    console.log("[NotificationScheduler] Initializing 60s attendance reminder daemon (08:50 AM morning & 06:00 PM evening)...");
    // Run an initial check after 5 seconds, then every 60 seconds
    setTimeout(() => this.evaluateScheduledReminders(), 5000);
    setInterval(() => this.evaluateScheduledReminders(), 60000);
  }
}

module.exports = new NotificationService();
