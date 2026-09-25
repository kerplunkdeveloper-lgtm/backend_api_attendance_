const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const attendanceService = require("./attendance.service");

function rawKey() {
  return `wp_bio_${crypto.randomBytes(24).toString("hex")}`;
}

async function createDevice(organizationId, { name, location }) {
  if (!name || !String(name).trim()) {
    const err = new Error("Device name is required");
    err.statusCode = 400;
    throw err;
  }
  const apiKey = rawKey();
  const device = await prisma.biometricDevice.create({
    data: {
      organizationId,
      name: String(name).trim(),
      location: location ? String(location).trim() : null,
      apiKeyHash: await bcrypt.hash(apiKey, 10),
      apiKeyPrefix: apiKey.slice(0, 12),
    },
  });
  return { ...device, apiKey };
}

async function listDevices(organizationId) {
  return prisma.biometricDevice.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      location: true,
      apiKeyPrefix: true,
      isActive: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
}

async function revokeDevice(organizationId, id) {
  await prisma.biometricDevice.updateMany({
    where: { id, organizationId },
    data: { isActive: false },
  });
  return { success: true };
}

async function resolveDevice(apiKey) {
  if (!apiKey) return null;
  const prefix = String(apiKey).slice(0, 12);
  const candidates = await prisma.biometricDevice.findMany({
    where: { apiKeyPrefix: prefix, isActive: true },
  });
  for (const device of candidates) {
    if (await bcrypt.compare(apiKey, device.apiKeyHash)) return device;
  }
  return null;
}

async function ingestPunch({ apiKey, employeeCode, punchType, timestamp }) {
  const device = await resolveDevice(apiKey);
  if (!device) {
    const err = new Error("Invalid biometric device key");
    err.statusCode = 401;
    throw err;
  }
  const org = await prisma.organization.findUnique({ where: { id: device.organizationId }, include: { subscription: true } });
  require("./entitlement.service").assertEntitled(org);
  const employee = await prisma.employee.findFirst({
    where: { organizationId: device.organizationId, employeeCode: String(employeeCode || "").trim(), deletedAt: null },
    include: { user: true },
  });
  if (!employee || !employee.userId || employee.user?.isActive === false || ["INACTIVE", "TERMINATED"].includes(employee.status)) {
    throw Object.assign(new Error("Active employee not found"), { statusCode: 404 });
  }
  const at = timestamp ? new Date(timestamp) : new Date();
  const age = Date.now() - at.getTime();
  if (!Number.isFinite(age) || age < -300000 || age > 7 * 86400000) {
    throw Object.assign(new Error("Timestamp must be within the last 7 days and at most 5 minutes ahead"), { statusCode: 400 });
  }
  const type = String(punchType || "").toUpperCase();
  if (!["IN", "OUT"].includes(type)) throw Object.assign(new Error("punchType must be IN or OUT"), { statusCode: 400 });
  const args = { userId: employee.userId, employeeId: employee.id, organizationId: device.organizationId, actorRole: "EMPLOYEE", timestamp: at.toISOString(), biometricDeviceId: device.id };
  // Both channels now use the same attendance events and payroll calculations.
  const result = type === "IN" ? await attendanceService.checkIn(args) : await attendanceService.checkOut(args);
  await prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return { ...result, punch: type, deviceId: device.id };

}

module.exports = { createDevice, listDevices, revokeDevice, ingestPunch };
