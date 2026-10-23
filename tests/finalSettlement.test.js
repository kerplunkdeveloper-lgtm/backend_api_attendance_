const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let exitRecord;
let settlementWrites;
let loanClosures;

const tx = {
  finalSettlement: { update: async ({ data }) => ({ ...exitRecord.finalSettlement, ...data }) },
  employeeExit: { update: async ({ data }) => ({ id: "exit-1", ...data }) },
  employee: { update: async () => ({}) },
  loanAdvance: {
    findMany: async () => [{ outstanding: 4000 }],
    updateMany: async (args) => {
      loanClosures.push(args);
      return { count: 1 };
    },
  },
};

mockPrisma({
  attendancePolicy: { findUnique: async () => null },
  employeeExit: {
    findFirst: async () => exitRecord,
    update: async () => ({}),
  },
  finalSettlement: {
    upsert: async (args) => {
      settlementWrites.push(args);
      return args.create;
    },
  },
  loanAdvance: { findMany: async () => [] },
  user: { update: async () => ({}) },
  refreshToken: { deleteMany: async () => ({}) },
  $transaction: async (fn) => fn(tx),
});

const offboardingService = require("../src/services/offboarding.service");

const salary = { baseSalary: 20000, hra: 6000, transport: 2000, special: 2000, otherAllowance: 0, pf: 0, professionalTax: 0 };

const baseExit = (overrides = {}) => ({
  id: "exit-1",
  organizationId: "org-1",
  employeeId: "emp-1",
  status: "RESIGNED",
  isNoticeWaived: true,
  noticePeriodDays: 30,
  resignationDate: new Date("2026-05-01T00:00:00Z"),
  approvedLastWorkingDate: new Date("2026-06-15T00:00:00Z"),
  clearances: [],
  finalSettlement: null,
  employee: {
    id: "emp-1",
    userId: "user-emp",
    firstName: "Priya",
    employeeCode: "EMP-1",
    salaryStructure: salary,
    expenses: [],
    leaveBalances: [
      { year: 2026, allocatedDays: 15, usedDays: 5, leaveType: { name: "Earned / Annual Leave", isPaid: true } },
      { year: 2026, allocatedDays: 30, usedDays: 0, leaveType: { name: "Unpaid Leave (LWP)", isPaid: false } },
    ],
  },
  ...overrides,
});

describe("final settlement", () => {
  beforeEach(() => {
    settlementWrites = [];
    loanClosures = [];
    exitRecord = baseExit();
  });

  it("pays the pro-rated gross and encashes only paid earned leave, with no NaN", async () => {
    await offboardingService.calculateFinalSettlement("org-1", "exit-1");
    const data = settlementWrites[0].create;
    assert.equal(data.finalSalaryPayable, 15000); // 30000 gross * 15/30
    assert.equal(data.leaveEncashmentDays, 10);
    assert.equal(data.leaveEncashmentAmount, 7692.3); // 10 days * (20000 / 26)
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === "number") assert.ok(Number.isFinite(value), `${key} must be finite`);
    }
  });

  it("refuses to invent a salary when none is configured", async () => {
    exitRecord = baseExit({ employee: { ...baseExit().employee, salaryStructure: null } });
    await assert.rejects(offboardingService.calculateFinalSettlement("org-1", "exit-1"), (err) => err.statusCode === 422);
    assert.equal(settlementWrites.length, 0);
  });

  it("does not recalculate a settlement that was already disbursed", async () => {
    exitRecord = baseExit({ finalSettlement: { status: "DISBURSED" } });
    await assert.rejects(offboardingService.calculateFinalSettlement("org-1", "exit-1"), (err) => err.statusCode === 409);
    assert.equal(settlementWrites.length, 0);
  });

  it("does not disburse the same settlement twice", async () => {
    exitRecord = baseExit({ finalSettlement: { status: "DISBURSED", netPayable: 100 } });
    await assert.rejects(
      offboardingService.disburseSettlementAndTerminate("org-1", "exit-1", {}, { email: "a@b.c" }),
      (err) => err.statusCode === 409,
    );
  });

  it("closes loans that the settlement recovered", async () => {
    exitRecord = baseExit({ finalSettlement: { status: "DRAFT", netPayable: 5000, loanOrAdvanceRecovery: 4000 } });
    const result = await offboardingService.disburseSettlementAndTerminate("org-1", "exit-1", {}, { email: "a@b.c" });
    assert.equal(result.success, true);
    assert.equal(loanClosures.length, 1);
    assert.equal(loanClosures[0].data.status, "CLOSED");
  });
});
