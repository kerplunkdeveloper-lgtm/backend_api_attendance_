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
  const employee = await prisma.employee.findFirst({
    where: {
      organizationId: device.organizationId,
      employeeCode: String(employeeCode || "").trim(),
      deletedAt: null,
      status: { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] },
    },
  });
  if (!employee) {
    const err = new Error("Employee code not found");
    err.statusCode = 404;
    throw err;
  }

  const type = String(punchType || "").toUpperCase();
  if (type !== "IN" && type !== "OUT") {
    const err = new Error("punchType must be IN or OUT");
    err.statusCode = 400;
    throw err;
  }

  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  const punchArgs = {
    userId: employee.userId,
    employeeId: employee.id,
    organizationId: device.organizationId,
    timestamp,
    actorRole: "COMPANY_ADMIN",
    skipGeofence: true,
    source: "BIOMETRIC",
    workMode: "OFFICE",
  };

  if (type === "OUT") {
    const updated = await attendanceService.checkOut(punchArgs);
    return { punch: "OUT", attendance: updated.attendance || updated, deviceId: device.id };
  }

  const created = await attendanceService.checkIn(punchArgs);
  return { punch: "IN", attendance: created.attendance || created, deviceId: device.id };
}

module.exports = { createDevice, listDevices, revokeDevice, ingestPunch };
