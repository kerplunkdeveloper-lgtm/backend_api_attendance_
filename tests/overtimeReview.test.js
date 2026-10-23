const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let request;
let attendanceWrites;

const tx = {
  attendance: { update: async (args) => { attendanceWrites.push(args); return {}; } },
  overtimeRequest: { update: async ({ data }) => ({ id: "ot-1", ...data }) },
};

mockPrisma({
  overtimeRequest: { findFirst: async () => request },
  notification: { create: async () => ({}) },
  $transaction: async (fn) => fn(tx),
});

const overtimeService = require("../src/services/overtime.service");

beforeEach(() => {
  attendanceWrites = [];
  request = {
    id: "ot-1",
    organizationId: "org-1",
    employeeId: "emp-1",
    attendanceId: "att-1",
    status: "PENDING",
    requestedMinutes: 90,
    attendance: { overtimeMinutes: 90 },
    employee: { userId: "u-emp", user: { role: "EMPLOYEE" } },
  };
});

describe("overtime approval", () => {
  it("cannot approve more minutes than were requested", async () => {
    await assert.rejects(
      overtimeService.reviewOvertimeRequest("org-1", "ot-1", "u-mgr", { status: "APPROVED", approvedMinutes: 600, reviewerRole: "MANAGER" }),
      (err) => err.statusCode === 400 && /at most 90/.test(err.message),
    );
    assert.equal(attendanceWrites.length, 0);
  });

  it("can approve fewer minutes than requested", async () => {
    await overtimeService.reviewOvertimeRequest("org-1", "ot-1", "u-mgr", { status: "APPROVED", approvedMinutes: 60, reviewerRole: "MANAGER" });
    assert.equal(attendanceWrites[0].data.overtimeMinutes, 60);
  });

  it("approves the full request by default", async () => {
    await overtimeService.reviewOvertimeRequest("org-1", "ot-1", "u-mgr", { status: "APPROVED", reviewerRole: "MANAGER" });
    assert.equal(attendanceWrites[0].data.overtimeMinutes, 90);
  });
});
