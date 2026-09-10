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
        isTrusted: true,
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
    return await prisma.employeeDevice.update({
      where: { id: deviceId },
      data: { isTrusted: Boolean(isTrusted) },
    });
  }

  /**
   * Delete device registration
   */
  async deleteDevice(deviceId, organizationId) {
    return await prisma.employeeDevice.delete({
      where: { id: deviceId },
    });
  }
}

module.exports = new DeviceService();
