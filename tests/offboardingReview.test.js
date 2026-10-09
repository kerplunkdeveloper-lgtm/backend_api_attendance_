const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

let currentExit = null;

stubSideEffects();
mockPrisma({
  employeeExit: {
    findFirst: async () => currentExit,
  },
  employeeClearance: {
    findFirst: async () => ({ id: "clearance-1", exitId: "exit-1", remarks: null }),
  },
});

const offboardingService = require("../src/services/offboarding.service");

const hr = { id: "user-hr", role: "MANAGER" };
const admin = { id: "user-admin", role: "COMPANY_ADMIN" };

const exitWith = (overrides = {}) => ({
  id: "exit-1",
  organizationId: "org-1",
  employeeId: "emp-1",
  exitType: "RESIGNATION",
  status: "RESIGNED",
  hrNotes: null,
  preferredLastWorkingDate: new Date("2026-11-07T00:00:00Z"),
  noticePeriodDays: 30,
  employee: {
    id: "emp-1",
    userId: "user-emp",
    firstName: "Priya",
    lastName: null,
    employeeCode: "EMP-1",
    user: { id: "user-emp", role: "EMPLOYEE" },
  },
  ...overrides,
});

describe("resignation review workflow", () => {
  beforeEach(() => {
    currentExit = exitWith();
  });

  it("does not let HR approve; HR has to forward to an admin", async () => {
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "APPROVE" }, hr),
      (e) => e.statusCode === 403 && /Forward it/.test(e.message),
    );
  });

  it("does not let HR reject either", async () => {
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "REJECT" }, hr),
      (e) => e.statusCode === 403,
    );
  });

  it("refuses to review an exit that already has a decision", async () => {
    currentExit = exitWith({ status: "REJECTED" });
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "APPROVE" }, admin),
      (e) => e.statusCode === 409,
    );
    currentExit = exitWith({ status: "NOTICE_PERIOD" });
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "FORWARD" }, hr),
      (e) => e.statusCode === 409,
    );
  });

  it("does not forward a resignation that is already with an admin", async () => {
    currentExit = exitWith({ status: "UNDER_HR_REVIEW" });
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "FORWARD" }, hr),
      (e) => e.statusCode === 409 && /already waiting/.test(e.message),
    );
  });

  it("stops anyone reviewing their own resignation", async () => {
    currentExit = exitWith({
      employee: { ...exitWith().employee, userId: "user-admin", user: { id: "user-admin", role: "COMPANY_ADMIN" } },
    });
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "APPROVE" }, admin),
      (e) => e.statusCode === 403 && /your own/.test(e.message),
    );
  });

  it("rejects unknown actions", async () => {
    await assert.rejects(
      () => offboardingService.reviewResignation("org-1", "exit-1", { action: "ACCEPT" }, admin),
      (e) => e.statusCode === 400,
    );
  });
});

describe("withdraw and clearances", () => {
  beforeEach(() => {
    currentExit = exitWith();
  });

  it("only the employee can withdraw their own resignation", async () => {
    await assert.rejects(
      () => offboardingService.withdrawExit("org-1", "exit-1", { id: "someone-else" }),
      (e) => e.statusCode === 403,
    );
  });

  it("cannot withdraw once the notice period has started", async () => {
    currentExit = exitWith({ status: "NOTICE_PERIOD" });
    await assert.rejects(
      () => offboardingService.withdrawExit("org-1", "exit-1", { id: "user-emp" }),
      (e) => e.statusCode === 409,
    );
  });

  it("does not start clearances before the resignation is approved", async () => {
    await assert.rejects(
      () => offboardingService.updateClearanceItem("org-1", "exit-1", "clearance-1", { status: "CLEARED" }, admin),
      (e) => e.statusCode === 409 && /after the resignation is approved/.test(e.message),
    );
  });
});
