const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let seenWhere;
mockPrisma({
  attendance: {
    findMany: async ({ where }) => { seenWhere = where; return []; },
    count: async () => 0,
  },
  organization: { findUnique: async () => ({ timezone: "UTC" }) },
  employee: { findMany: async () => ([{
    id: "employee-1",
    firstName: "Absent",
    lastName: "Person",
    employeeCode: "EMP-1",
    designation: null,
    avatarUrl: null,
    avatarStorageKey: null,
    branchId: null,
    department: null,
    user: { email: "absent@example.com", role: "EMPLOYEE", avatarUrl: null, avatarStorageKey: null },
    branch: null,
    shift: { id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", graceMinutes: 0, workingDays: "0,1,2,3,4,5,6" },
  }]) },
  leaveRequest: { findMany: async () => [] },
  holiday: { findMany: async () => [] },
  companyLeave: { findMany: async () => [] },
});

const { getAttendanceHistory } = require("../src/services/attendance.service");

describe("attendance history filters", () => {
  it("filters Punch out to open sessions rather than a stored status", async () => {
    await getAttendanceHistory({
      userId: "u-1",
      organizationId: "org-1",
      role: "COMPANY_ADMIN",
      status: "PUNCH_OUT",
    });

    assert.deepEqual(seenWhere.checkIn, { not: null });
    assert.equal(seenWhere.checkOut, null);
    assert.deepEqual(seenWhere.status, { not: "ABSENT" });
  });

  it("shows a not-yet-marked absence when This month includes today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await getAttendanceHistory({
      userId: "u-1",
      organizationId: "org-1",
      role: "COMPANY_ADMIN",
      from: today.slice(0, 8) + "01",
      to: today,
      status: "ABSENT",
    });

    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].status, "ABSENT");
    assert.equal(result.records[0].employeeId, "employee-1");
  });
});
