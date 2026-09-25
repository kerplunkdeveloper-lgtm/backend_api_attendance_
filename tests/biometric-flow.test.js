const { test } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { mockPrisma } = require("./helpers/mockPrisma");
let record = null;
const events = [];
const org = { id: "org", timezone: "UTC", subscriptionPlan: "PROFESSIONAL", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date(Date.now() + 86400000) };
const device = { id: "device", organizationId: "org", isActive: true, apiKeyHash: bcrypt.hashSync("device-key", 4) };
const employee = { id: "employee", userId: "user", organizationId: "org", employeeCode: "E1", status: "ACTIVE", branch: null, shift: null, user: { isActive: true } };
const prisma = {
  organization: { findUnique: async () => org },
  biometricDevice: { findMany: async () => [device], findFirst: async () => device, update: async () => device },
  employee: { findFirst: async () => employee },
  attendancePolicy: { findUnique: async () => ({ requireTrustedDevice: true, geofenceStrict: true, allowWfh: false }) },
  shiftOverride: { findUnique: async () => null }, shift: { findFirst: async () => null },
  branch: { findMany: async () => [] }, holiday: { findFirst: async () => null }, leaveRequest: { findFirst: async () => null },
  attendance: {
    findUnique: async () => record ? { ...record, events: [...events].reverse(), shift: null } : null,
    findFirst: async () => record,
    upsert: async ({ create, update }) => { record = record ? { ...record, ...update } : { id: "attendance", ...create }; return record; },
    update: async ({ data }) => { record = { ...record, ...data }; return record; },
  },
  attendanceEvent: { create: async ({ data }) => { events.push(data);return data; } },
  $executeRaw: async () => 1,
  $transaction: async fn => fn(prisma),
};
mockPrisma(prisma);
const service = require("../src/services/biometric.service");
test("biometric IN/OUT preserve first punch and compute working minutes with events", async () => {
  const start = new Date();start.setUTCHours(0, 0, 0, 0);start.setUTCDate(start.getUTCDate() - 1);start.setUTCHours(8);
  const end = new Date(start.getTime() + 9 * 3600000);
  await service.ingestPunch({ apiKey: "device-key", employeeCode: "E1", punchType: "IN", timestamp: start.toISOString() });
  await assert.rejects(() => service.ingestPunch({ apiKey: "device-key", employeeCode: "E1", punchType: "IN", timestamp: new Date(start.getTime() + 60000).toISOString() }), /Already checked in/);
  assert.equal(record.checkIn.toISOString(), start.toISOString());
  await service.ingestPunch({ apiKey: "device-key", employeeCode: "E1", punchType: "OUT", timestamp: end.toISOString() });
  assert.equal(record.workingMinutes, 540);assert.equal(record.overtimeMinutes, 60);
  assert.deepEqual(events.map(e => e.type), ["CHECK_IN", "CHECK_OUT"]);
});
