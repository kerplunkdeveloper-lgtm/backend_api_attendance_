const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let attendanceRows = [];
let lastAttendanceWhere = null;

mockPrisma({
  organization: {
    findUnique: async () => ({ timezone: "Asia/Kolkata" }),
  },
  employee: {
    count: async () => 10,
  },
  attendance: {
    findMany: async ({ where }) => {
      lastAttendanceWhere = where;
      return attendanceRows;
    },
  },
  holiday: {
    findFirst: async () => null,
  },
});

const { getAttendanceSummary } = require("../src/services/attendance.service");

describe("attendance summary", () => {
  beforeEach(() => {
    attendanceRows = [];
    lastAttendanceWhere = null;
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("uses the tenant's local day, not the server's UTC day, when no date is given", async () => {
    // 01:30 IST on 23 Oct is still 22 Oct in UTC.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-22T20:00:00.000Z") });

    const summary = await getAttendanceSummary("org-1");

    assert.equal(summary.date, "2026-10-23");
    assert.equal(lastAttendanceWhere.date.toISOString(), "2026-10-23T00:00:00.000Z");
  });

  it("starts the day empty so yesterday's punches never leak into today", async () => {
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-22T20:00:00.000Z") });

    const summary = await getAttendanceSummary("org-1");

    assert.equal(summary.totalPunches, 0);
    assert.equal(summary.attendanceRate, 0);
    assert.deepEqual(summary.hourlyCheckIns, new Array(24).fill(0));
  });

  it("counts today's clock-ins and buckets them by the tenant's local hour", async () => {
    attendanceRows = [
      { status: "PRESENT", checkIn: new Date("2026-10-23T03:45:00.000Z"), checkOut: null }, // 09:15 IST
      { status: "LATE", checkIn: new Date("2026-10-23T04:10:00.000Z"), checkOut: null }, // 09:40 IST
      { status: "WORK_FROM_HOME", checkIn: new Date("2026-10-23T05:00:00.000Z"), checkOut: new Date("2026-10-23T06:00:00.000Z") }, // 10:30 IST
      { status: "ON_LEAVE", checkIn: null, checkOut: null },
    ];

    const summary = await getAttendanceSummary("org-1", "2026-10-23");

    assert.equal(summary.totalPunches, 3);
    assert.equal(summary.hourlyCheckIns[9], 2);
    assert.equal(summary.hourlyCheckIns[10], 1);
    assert.equal(
      summary.hourlyCheckIns.reduce((sum, count) => sum + count, 0),
      summary.totalPunches,
    );
    assert.equal(summary.currentlyClockedIn, 2);
    assert.equal(summary.attendanceRate, 30);
    assert.equal(summary.timezone, "Asia/Kolkata");
  });

  it("honours an explicit date", async () => {
    await getAttendanceSummary("org-1", "2026-10-01");

    assert.equal(lastAttendanceWhere.date.toISOString(), "2026-10-01T00:00:00.000Z");
  });

  it("rejects an unparseable date with a 400", async () => {
    await assert.rejects(() => getAttendanceSummary("org-1", "not-a-date"), (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    });
  });
});
