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
    where: { organizationId: device.organizationId, employeeCode: String(employeeCode || "").trim() },
  });
  if (!employee) {
    const err = new Error("Employee code not found");
    err.statusCode = 404;
    throw err;
  }

  const at = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(at.getTime())) {
    const err = new Error("Invalid timestamp");
    err.statusCode = 400;
    throw err;
  }
  const date = await attendanceService.getOrgDateOnly(device.organizationId, at);
  const type = String(punchType || "IN").toUpperCase();

  await prisma.biometricDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() },
  });

  if (type === "OUT") {
    const open = await attendanceService.findOpenAttendance(employee.id, device.organizationId, at);
    if (!open?.checkIn) {
      const err = new Error("No open check-in to close");
      err.statusCode = 400;
      throw err;
    }
    const updated = await prisma.attendance.update({
      where: { id: open.id },
      data: { checkOut: at },
    });
    return { punch: "OUT", attendance: updated, deviceId: device.id };
  }

  const attendance = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId: employee.id, date } },
    update: { checkIn: at, status: "PRESENT" },
    create: {
      organizationId: device.organizationId,
      employeeId: employee.id,
      date,
      checkIn: at,
      status: "PRESENT",
    },
  });
  return { punch: "IN", attendance, deviceId: device.id };
}

module.exports = { createDevice, listDevices, revokeDevice, ingestPunch };
