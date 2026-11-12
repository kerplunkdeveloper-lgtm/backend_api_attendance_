const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const attendanceService = require("./attendance.service");

function rawKey() {
  return `wp_bio_${crypto.randomBytes(24).toString("hex")}`;
}

function normalizeCardUid(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCredentialType(value) {
  const type = String(value || "CARD_UID").trim().toUpperCase();
  return ["CARD_UID", "NFC_UID", "BIOMETRIC_USER_ID"].includes(type) ? type : "CARD_UID";
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

async function listCredentials(organizationId) {
  return prisma.biometricCredential.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } },
    },
  });
}

async function assignCard(organizationId, { employeeId, cardUid, cardId, credentialValue, credentialType, label }) {
  const value = normalizeCardUid(cardUid || cardId || credentialValue);
  const type = normalizeCredentialType(credentialType);
  if (!employeeId || !value) {
    const err = new Error("Employee and card ID are required");
    err.statusCode = 400;
    throw err;
  }
  const employee = await prisma.employee.findFirst({
    where: { id: String(employeeId), organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }
  const cardOwner = await prisma.biometricCredential.findFirst({
    where: { organizationId, credentialType: type, cardUid: value, NOT: { employeeId: String(employeeId) } },
    select: { employeeId: true },
  });
  if (cardOwner) {
    const err = new Error("This card is already assigned to another employee");
    err.statusCode = 409;
    throw err;
  }
  return prisma.biometricCredential.upsert({
    where: { organizationId_employeeId_credentialType: { organizationId, employeeId: String(employeeId), credentialType: type } },
    update: { cardUid: value, label: label ? String(label).trim() : null, isActive: true },
    create: { organizationId, employeeId: String(employeeId), credentialType: type, cardUid: value, label: label ? String(label).trim() : null },
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, status: true } } },
  });
}

async function removeCard(organizationId, id) {
  await prisma.biometricCredential.deleteMany({ where: { id, organizationId } });
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

async function ingestPunch({ apiKey, employeeCode, cardUid, cardId, badgeId, credentialValue, credentialType, punchType, timestamp }) {
  const device = await resolveDevice(apiKey);
  if (!device) {
    const err = new Error("Invalid biometric device key");
    err.statusCode = 401;
    throw err;
  }
  const normalizedCard = normalizeCardUid(cardUid || cardId || badgeId || credentialValue);
  const normalizedType = normalizeCredentialType(credentialType);
  const employee = normalizedCard
    ? (await prisma.biometricCredential.findFirst({
        where: { organizationId: device.organizationId, credentialType: normalizedType, cardUid: normalizedCard, isActive: true, employee: { deletedAt: null, status: { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] } } },
        include: { employee: true },
      }))?.employee
    : await prisma.employee.findFirst({
        where: {
          organizationId: device.organizationId,
          employeeCode: String(employeeCode || "").trim(),
          deletedAt: null,
          status: { in: ["ACTIVE", "PROBATION", "NOTICE_PERIOD"] },
        },
      });
  if (!employee) {
    const err = new Error(normalizedCard ? "Credential is not assigned to an active employee" : "Employee code not found");
    err.statusCode = 404;
    throw err;
  }

  let type = String(punchType || "TOGGLE").toUpperCase();
  if (type === "TOGGLE") {
    const status = await attendanceService.getTodayStatus(employee.userId, device.organizationId, "EMPLOYEE");
    type = status.clockedIn ? "OUT" : "IN";
  }
  if (type !== "IN" && type !== "OUT") {
    const err = new Error("punchType must be IN, OUT, or TOGGLE");
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

module.exports = { createDevice, listDevices, revokeDevice, listCredentials, assignCard, removeCard, ingestPunch };
