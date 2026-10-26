const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let seenWhere;
mockPrisma({
  organization: { findUnique: async () => ({ timezone: "UTC" }) },
  attendance: {
    findMany: async ({ where }) => {
      seenWhere = where;
      return [];
    },
    count: async () => 0,
  },
});

const { getAllAttendance } = require("../src/services/attendance.service");

describe("attendance list by the employee's branch", () => {
  beforeEach(() => {
    seenWhere = null;
  });

  it("filters on the branch the employee belongs to", async () => {
    await getAllAttendance("org-1", { date: "2026-10-26", employeeBranchId: "b-salem" });
    assert.deepEqual(seenWhere.employee, { branchId: "b-salem" });
    assert.equal(seenWhere.branchId, undefined, "it must not filter on the branch the punch matched");
  });

  it("the older branchId filter still means the branch the punch matched", async () => {
    await getAllAttendance("org-1", { branchId: "b-salem" });
    assert.equal(seenWhere.branchId, "b-salem");
    assert.equal(seenWhere.employee, undefined);
  });

  it("'ALL' or nothing means no branch filter", async () => {
    await getAllAttendance("org-1", { employeeBranchId: "ALL" });
    assert.equal(seenWhere.employee, undefined);
    await getAllAttendance("org-1", {});
    assert.equal(seenWhere.employee, undefined);
  });
});
