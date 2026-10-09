const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const employee = {
  id: "emp-1",
  organizationId: "org-1",
  userId: "user-1",
  branchId: null,
  shiftId: null,
  shift: null,
  branch: null,
};

const prisma = mockPrisma({
  organization: {
    findUnique: async () => ({ timezone: "UTC" }),
  },
  attendancePolicy: {
    findUnique: async () => ({ requireTrustedDevice: false, allowWfh: true, geofenceStrict: true }),
  },
  employee: {
    findFirst: async () => employee,
  },
  shiftOverride: {
    findUnique: async () => null,
  },
  shift: {
    findFirst: async () => null,
  },
  branch: {
    findMany: async () => [],
  },
  holiday: {
    findFirst: async () => null,
  },
  leaveRequest: {
    findFirst: async () => null,
  },
  attendance: {
    findUnique: async () => ({
      id: "att-1",
      checkIn: new Date("2026-09-21T09:00:00.000Z"),
      events: [],
    }),
  },
});

const { checkIn } = require("../src/services/attendance.service");

describe("attendance", () => {
  it("rejects a duplicate check-in for the same day", async () => {
    await assert.rejects(
      () =>
        checkIn({
          userId: "user-1",
          organizationId: "org-1",
          latitude: 0,
          longitude: 0,
          workMode: "WORK_FROM_HOME",
        }),
      /Already checked in/
    );
  });

  it("refuses an office-mode punch without location when check-in is office only", async () => {
    const original = prisma.branch.findMany;
    prisma.branch.findMany = async () => [
      { id: "br-1", name: "Andheri office", latitude: "19.1197", longitude: "72.8468", radiusMeters: 200 },
    ];
    try {
      await assert.rejects(
        () => checkIn({ userId: "user-1", organizationId: "org-1", workMode: "OFFICE" }),
        (err) => err.code === "LOCATION_REQUIRED" && err.statusCode === 403
      );
    } finally {
      prisma.branch.findMany = original;
    }
  });
});
