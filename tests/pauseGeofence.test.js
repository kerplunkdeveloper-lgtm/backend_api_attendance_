const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const employee = { id: "emp-1", userId: "user-1", organizationId: "org-1", branchId: "branch-1" };
const now = () => new Date().toISOString();
let attendance;
let createdEvents;

mockPrisma({
  organization: { findUnique: async () => ({ timezone: "UTC" }) },
  employee: { findFirst: async () => employee },
  attendancePolicy: { findUnique: async () => ({}) },
  branch: { findMany: async () => [{ id: "branch-1", name: "HQ", latitude: 11.9329, longitude: 79.8072, radiusMeters: 200 }] },
  attendance: {
    findUnique: async () => attendance,
    findFirst: async () => null,
    update: async ({ data }) => {
      attendance = { ...attendance, ...data };
      return attendance;
    },
  },
  attendanceEvent: {
    create: async ({ data }) => {
      createdEvents.push(data);
      return { id: `event-${createdEvents.length}`, ...data };
    },
  },
  $transaction: async (callback) => callback({
    attendance: { update: async ({ data }) => ({ ...attendance, ...data }) },
    attendanceEvent: { create: async ({ data }) => { createdEvents.push(data); return { id: `event-${createdEvents.length}`, ...data }; } },
  }),
});

const { startBreak, endBreak, startLunch, endLunch } = require("../src/services/attendance.service");

const office = { latitude: 11.9329, longitude: 79.8072, accuracy: 10 };

test("break and lunch start reject locations outside the office geofence", async () => {
  attendance = { id: "att-1", status: "PRESENT", checkIn: new Date(Date.now() - 60_000), checkOut: null, breakMinutes: 0, lunchMinutes: 0, events: [] };
  createdEvents = [];

  await assert.rejects(
    () => startBreak({ userId: "user-1", organizationId: "org-1", latitude: 12.1, longitude: 79.8, timestamp: now() }),
    (error) => error.statusCode === 403 && error.code === "OUTSIDE_OFFICE",
  );
  await assert.rejects(
    () => startLunch({ userId: "user-1", organizationId: "org-1", latitude: 12.1, longitude: 79.8, timestamp: now() }),
    (error) => error.statusCode === 403 && error.code === "OUTSIDE_OFFICE",
  );
  assert.equal(createdEvents.length, 0);
});

test("break and lunch start/end work inside the office geofence", async () => {
  attendance = { id: "att-1", status: "PRESENT", checkIn: new Date(Date.now() - 60_000), checkOut: null, breakMinutes: 0, lunchMinutes: 0, events: [] };
  createdEvents = [];

  await startBreak({ userId: "user-1", organizationId: "org-1", ...office, timestamp: now() });
  attendance.events = [{ type: "BREAK_START", timestamp: new Date(Date.now() - 60_000) }];
  await endBreak({ userId: "user-1", organizationId: "org-1", ...office, timestamp: now() });

  attendance.events = [];
  await startLunch({ userId: "user-1", organizationId: "org-1", ...office, timestamp: now() });
  attendance.events = [{ type: "LUNCH_START", timestamp: new Date(Date.now() - 60_000) }];
  await endLunch({ userId: "user-1", organizationId: "org-1", ...office, timestamp: now() });

  assert.deepEqual(createdEvents.map((event) => event.type), ["BREAK_START", "BREAK_END", "LUNCH_START", "LUNCH_END"]);
});
