const prisma = require("../config/database");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { getLocalDateOnly, getLocalMidnightInstant } = require("../utils/datetime");

class DeviceService {
  /**
   * Record the first use of an employee/device pair for the tenant's local
   * calendar day. This is intentionally best-effort: a notification failure
   * must never prevent a valid attendance punch.
   */
  async recordDailyUse({ userId, organizationId, employee, deviceId, timestamp, ipAddress }) {
    if (!deviceId || !employee?.id) return null;
    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId }, select: { deviceVerificationEnabled: true, deviceConflictAlertEnabled: true } }).catch(() => null);
    if (policy?.deviceVerificationEnabled === false) return null;

    const device = await prisma.employeeDevice.findFirst({
      where: { organizationId, employeeId: employee.id, deviceId: String(deviceId) },
      select: { id: true, deviceModel: true, osVersion: true },
    });
    if (!device) return null;

    const otherOwner = await prisma.employeeDevice.findFirst({
      where: { organizationId, deviceId: String(deviceId), employeeId: { not: employee.id } },
      select: {
        employeeId: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });
    const previousOwner = otherOwner?.employee
      ? {
          id: otherOwner.employee.id,
          employeeId: otherOwner.employee.id,
          name: `${otherOwner.employee.firstName || ""} ${otherOwner.employee.lastName || ""}`.trim(),
          employeeCode: otherOwner.employee.employeeCode,
          branchId: otherOwner.employee.branchId || null,
          branchName: otherOwner.employee.branch?.name || null,
        }
      : null;
    const timezoneRow = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const day = getLocalDateOnly(timestamp || new Date(), timezoneRow?.timezone);
    const dayStart = getLocalMidnightInstant(day, timezoneRow?.timezone);
    const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const dayEnd = getLocalMidnightInstant(nextDay, timezoneRow?.timezone);
    const eventType = otherOwner ? "DUPLICATE_DEVICE" : "NEW_DEVICE_USE";
    const alreadyAlerted = await prisma.auditLog.findFirst({
      where: { organizationId, employeeId: employee.id, deviceId: String(deviceId), eventType, createdAt: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    });
    if (alreadyAlerted) return alreadyAlerted;
    if (otherOwner && policy?.deviceConflictAlertEnabled === false) return null;

    const log = await auditService.logAction({
      organizationId, userId, action: "FLAGGED", entity: "DEVICE", entityId: device.id,
      employeeId: employee.id, branchId: employee.branchId, deviceId: String(deviceId), deviceName: device.deviceModel || "Unknown Device",
      eventType, riskLevel: otherOwner ? "HIGH" : "LOW", reviewStatus: "PENDING", ipAddress,
      details: {
        firstUseToday: true,
        punchTriggered: true,
        osVersion: device.osVersion || "Unknown OS",
        previousOwner,
        previousOwners: previousOwner ? [previousOwner] : [],
      },
    });
    void notificationService.notifyReviewersOfRequest({
      organizationId,
      employeeId: employee.id,
      title: otherOwner ? "Duplicate attendance device used" : "Attendance device used",
      summary: otherOwner
        ? `used ${device.deviceModel || "a device"} already registered to ${previousOwner?.name || "another employee"}.`
        : `used ${device.deviceModel || "a registered device"} for attendance today. HR verification is required.`,
      type: "SECURITY",
    });
    return log;
  }

  /**
   * Register or bind employee device
   */
  async registerDevice(userId, organizationId, data, request = {}) {
    const { deviceId, deviceModel, osVersion } = data;

    if (!deviceId) {
      const error = new Error("deviceId is required");
      error.statusCode = 400;
      throw error;
    }

    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) {
      const error = new Error("Employee profile not found");
      error.statusCode = 404;
      throw error;
    }

    const otherOwners = await prisma.employeeDevice.findMany({
      where: { organizationId, deviceId: String(deviceId), employeeId: { not: employee.id } },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, branchId: true } } },
    });

    const existingDevice = await prisma.employeeDevice.findUnique({
      where: { employeeId_deviceId: { employeeId: employee.id, deviceId: String(deviceId) } },
      select: { id: true, deviceModel: true, osVersion: true },
    });

    const device = await prisma.employeeDevice.upsert({
      where: {
        employeeId_deviceId: {
          employeeId: employee.id,
          deviceId,
        },
      },
      update: {
        deviceModel: deviceModel || undefined,
        osVersion: osVersion || undefined,
        lastUsedAt: new Date(),
      },
      create: {
        organizationId,
        employeeId: employee.id,
        deviceId,
        deviceModel: deviceModel || "Unknown Device",
        osVersion: osVersion || "Unknown OS",
        isTrusted: false,
      },
    });

    const policy = await prisma.attendancePolicy.findUnique({ where: { organizationId }, select: { deviceVerificationEnabled: true, deviceConflictAlertEnabled: true } }).catch(() => null);
    const deviceVerificationEnabled = policy?.deviceVerificationEnabled !== false;
    if (otherOwners.length && policy?.deviceConflictAlertEnabled !== false) {
      void notificationService.notifyReviewersOfRequest({
        organizationId,
        employeeId: employee.id,
        title: "Duplicate attendance device needs review",
        summary: `tried to register ${deviceModel || "a device"}, which is already registered to another employee.`,
        type: "SECURITY",
      });
    }

    // Allow laptop + phone usage, but create one HR review event per
    // employee/device/day instead of alerting on every punch.
    let dailyAlert = null;
    if (!otherOwners.length && deviceVerificationEnabled) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const alreadyAlerted = await prisma.auditLog.findFirst({
        where: { organizationId, employeeId: employee.id, deviceId: String(deviceId), eventType: "NEW_DEVICE_USE", createdAt: { gte: dayStart, lt: dayEnd } },
        select: { id: true },
      });
      if (!alreadyAlerted) {
        dailyAlert = await auditService.logAction({
          organizationId, userId, action: "FLAGGED", entity: "DEVICE", entityId: device.id,
          employeeId: employee.id, branchId: employee.branchId, deviceId: String(deviceId),
          deviceName: deviceModel || existingDevice?.deviceModel || "Unknown Device",
          eventType: "NEW_DEVICE_USE", riskLevel: existingDevice ? "LOW" : "MEDIUM",
          reviewStatus: "PENDING", ipAddress: request.ip,
          details: { firstUseToday: true, isNewDevice: !existingDevice, osVersion: osVersion || existingDevice?.osVersion || "Unknown OS" },
        });
        void notificationService.notifyReviewersOfRequest({
          organizationId,
          employeeId: employee.id,
          title: "Attendance device used",
          summary: `used ${deviceModel || existingDevice?.deviceModel || "a registered device"} for attendance today. HR verification is required.`,
          type: "SECURITY",
        });
      }
    }

    await auditService.logAction({
      organizationId, userId, action: otherOwners.length ? "FLAGGED" : "CREATE", entity: "DEVICE", entityId: device.id,
      employeeId: employee.id, branchId: employee.branchId, deviceId: String(deviceId), deviceName: deviceModel || "Unknown Device",
      eventType: otherOwners.length ? "DUPLICATE_DEVICE" : "DEVICE_REGISTERED", riskLevel: otherOwners.length ? "HIGH" : "LOW",
      reviewStatus: otherOwners.length ? "PENDING" : "NOT_REQUIRED", ipAddress: request.ip,
      details: { deviceModel: deviceModel || "Unknown Device", osVersion: osVersion || "Unknown OS", previousOwners: otherOwners.map((row) => ({ employeeId: row.employee.id, employeeCode: row.employee.employeeCode, name: `${row.employee.firstName} ${row.employee.lastName || ""}`.trim() })) },
    });

    return { ...device, punchAllowed: true, alertCreated: Boolean(dailyAlert), conflict: otherOwners.length > 0, previousOwners: otherOwners.map((row) => row.employee) };
  }

  /**
   * Get devices registered by employee
   */
  async getMyDevices(userId, organizationId) {
    const employee = await prisma.employee.findFirst({
      where: { userId, organizationId },
    });

    if (!employee) return [];

    return await prisma.employeeDevice.findMany({
      where: { employeeId: employee.id, organizationId },
      orderBy: { lastUsedAt: "desc" },
    });
  }

  /**
   * List all organization registered devices (Admin)
   */
  async getAllDevices(organizationId) {
    return await prisma.employeeDevice.findMany({
      take: 1000, // safety cap: a person's own history can grow for years
      where: { organizationId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { lastUsedAt: "desc" },
    });
  }

  /**
   * Trust or revoke employee device
   */
  async updateDeviceTrust(deviceId, organizationId, isTrusted, actor = {}) {
    // Scoped by org — matching on the device id alone let a caller who knew a
    // UUID flip trust on another tenant's device.
    const trusted = isTrusted === true || isTrusted === 1 || (typeof isTrusted === "string" && ["true", "1"].includes(isTrusted.trim().toLowerCase()));
    const result = await prisma.employeeDevice.updateMany({
      where: { id: deviceId, organizationId },
      data: { isTrusted: trusted },
    });

    if (result.count === 0) {
      const error = new Error("Device not found");
      error.statusCode = 404;
      throw error;
    }

    const device = await prisma.employeeDevice.findUnique({ where: { id: deviceId }, include: { employee: { select: { id: true, branchId: true } } } });
    await auditService.logAction({ organizationId, userId: actor.userId, action: trusted ? "APPROVE" : "REJECT", entity: "DEVICE", entityId: deviceId, employeeId: device?.employeeId, branchId: device?.employee?.branchId, deviceId: device?.deviceId, deviceName: device?.deviceModel, eventType: trusted ? "DEVICE_APPROVED" : "DEVICE_REVOKED", riskLevel: "LOW", reviewStatus: trusted ? "APPROVED" : "REJECTED", ipAddress: actor.ip });
    return device;
  }

  /**
   * Delete device registration
   */
  async deleteDevice(deviceId, organizationId) {
    const result = await prisma.employeeDevice.deleteMany({
      where: { id: deviceId, organizationId },
    });

    if (result.count === 0) {
      const error = new Error("Device not found");
      error.statusCode = 404;
      throw error;
    }

    return { id: deviceId, deleted: true };
  }
}

module.exports = new DeviceService();
