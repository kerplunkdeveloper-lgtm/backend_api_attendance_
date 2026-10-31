const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

let attendanceLookups;
mockPrisma({
  organization: { findUnique: async () => ({ timezone: "America/Los_Angeles" }) },
  employee: { findFirst: async () => ({ id: "emp-1" }) },
  attendance: {
    findFirst: async ({ where }) => {
      attendanceLookups.push(where);
      return { id: "att-1", employeeId: "emp-1", organizationId: "org-1", checkOut: new Date(), overtimeMinutes: 120 };
    },
  },
  overtimeRequest: {
    findFirst: async () => null,
    create: async ({ data }) => ({ id: "ot-1", ...data }),
  },
});

const overtime = require("../src/services/overtime.service");

describe("overtime request by date", () => {
  beforeEach(() => { attendanceLookups = []; });

  it("keeps a date-only request on the selected calendar date", async () => {
    const result = await overtime.requestOvertime("org-1", "user-1", { date: "2026-10-31", hours: 1, reason: "Release support" });
    assert.equal(result.success, true);
    assert.equal(attendanceLookups[0].date.toISOString(), "2026-10-31T00:00:00.000Z");
  });
});
