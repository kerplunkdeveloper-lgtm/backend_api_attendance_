const { describe, it, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const MON = "1,2,3,4,5,6";
const emp = (id, branchId, workingDays = MON) => ({ id, branchId, shift: { workingDays } });

let employees;
let attendances;
let leaves;
let holidays;
let companyLeaves;

mockPrisma({
  organization: { findUnique: async () => ({ timezone: "UTC" }) },
  branch: {
    findMany: async () => [
      { id: "b-salem", name: "Salem" },
      { id: "b-chennai", name: "Chennai" },
    ],
  },
  employee: { findMany: async () => employees },
  attendance: { findMany: async () => attendances },
  leaveRequest: { findMany: async () => leaves },
  holiday: { findMany: async () => holidays },
  companyLeave: { findMany: async () => companyLeaves },
});

const { getBranchSummary } = require("../src/services/attendance.service");
const byName = (res) => Object.fromEntries(res.branches.map((b) => [b.name, b]));

describe("branch attendance summary", () => {
  beforeEach(() => {
    // A Monday: a working day for every shift below.
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-26T08:00:00.000Z") });
    employees = [];
    attendances = [];
    leaves = [];
    holidays = [];
    companyLeaves = [];
  });
  afterEach(() => mock.timers.reset());

  it("shows present out of total for each branch", async () => {
    employees = Array.from({ length: 10 }, (_, i) => emp(`s${i}`, "b-salem"));
    attendances = [{ employeeId: "s0", status: "PRESENT" }];
    const { branches } = await getBranchSummary("org-1");
    const salem = byName({ branches }).Salem;
    assert.equal(`${salem.present}/${salem.total}`, "1/10");
    assert.equal(salem.absent, 9);
  });

  it("counts late and remote people as present, and also tells how many were late or remote", async () => {
    employees = [emp("a", "b-salem"), emp("b", "b-salem"), emp("c", "b-salem"), emp("d", "b-salem")];
    attendances = [
      { employeeId: "a", status: "PRESENT" },
      { employeeId: "b", status: "LATE" },
      { employeeId: "c", status: "WORK_FROM_HOME" },
      { employeeId: "d", status: "HALF_DAY" },
    ];
    const salem = byName(await getBranchSummary("org-1")).Salem;
    assert.deepEqual([salem.present, salem.late, salem.wfh, salem.absent], [4, 1, 1, 0]);
  });

  it("keeps each branch's people in its own row", async () => {
    employees = [emp("a", "b-salem"), emp("b", "b-chennai"), emp("c", "b-chennai")];
    attendances = [{ employeeId: "b", status: "PRESENT" }];
    const res = byName(await getBranchSummary("org-1"));
    assert.deepEqual([res.Salem.present, res.Salem.total], [0, 1]);
    assert.deepEqual([res.Chennai.present, res.Chennai.total], [1, 2]);
  });

  it("separates leave, off and absent: nobody off or on leave is counted absent", async () => {
    employees = [emp("leave", "b-salem"), emp("marked-leave", "b-salem"), emp("marked-holiday", "b-salem"), emp("gone", "b-salem")];
    leaves = [{ employeeId: "leave" }];
    attendances = [
      { employeeId: "marked-leave", status: "ON_LEAVE" },
      { employeeId: "marked-holiday", status: "HOLIDAY" },
    ];
    const salem = byName(await getBranchSummary("org-1")).Salem;
    assert.deepEqual([salem.onLeave, salem.off, salem.absent, salem.present], [2, 1, 1, 0]);
  });

  it("a company-wide holiday puts everyone off, a branch holiday only that branch", async () => {
    employees = [emp("a", "b-salem"), emp("b", "b-chennai")];
    holidays = [{ branchId: "b-salem" }];
    let res = byName(await getBranchSummary("org-1"));
    assert.deepEqual([res.Salem.off, res.Salem.absent], [1, 0]);
    assert.deepEqual([res.Chennai.off, res.Chennai.absent], [0, 1]);

    holidays = [{ branchId: null }];
    res = byName(await getBranchSummary("org-1"));
    assert.deepEqual([res.Salem.off, res.Chennai.off], [1, 1]);
  });

  it("company leave puts people off, like a holiday", async () => {
    employees = [emp("a", "b-salem")];
    companyLeaves = [{ branchId: null }];
    assert.equal(byName(await getBranchSummary("org-1")).Salem.off, 1);
  });

  it("someone on their weekly off is off, not absent", async () => {
    employees = [emp("a", "b-salem", "2,3,4,5,6"), emp("b", "b-salem")]; // a does not work Mondays
    const salem = byName(await getBranchSummary("org-1")).Salem;
    assert.deepEqual([salem.off, salem.absent], [1, 1]);
  });

  it("people without a branch appear last, and the totals add up", async () => {
    employees = [emp("a", "b-salem"), emp("b", null), emp("c", "b-chennai")];
    attendances = [{ employeeId: "a", status: "PRESENT" }];
    const res = await getBranchSummary("org-1");
    assert.equal(res.branches.at(-1).name, "No branch");
    assert.deepEqual([res.totals.total, res.totals.present, res.totals.absent], [3, 1, 2]);
  });

  it("lists a branch with nobody in it, with 0 of 0", async () => {
    employees = [emp("a", "b-salem")];
    const res = byName(await getBranchSummary("org-1"));
    assert.deepEqual([res.Chennai.present, res.Chennai.total], [0, 0]);
  });
});
