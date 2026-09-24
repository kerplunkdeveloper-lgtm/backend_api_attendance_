const prisma = require("../config/database");

class DeviceService {
  /**
   * Register or bind employee device
   */
  async registerDevice(userId, organizationId, data) {
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

    return device;
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
  async updateDeviceTrust(deviceId, organizationId, isTrusted) {
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

    return await prisma.employeeDevice.findUnique({ where: { id: deviceId } });
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
