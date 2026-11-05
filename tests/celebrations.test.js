const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let lastQuery;
mockPrisma({
  organization: { findUnique: async () => ({ hrAccess: null }) },
  employee: {
    findMany: async (query) => {
      lastQuery = query;
      return [
        {
          id: "e1", firstName: "Asha", lastName: "Rao", designation: "Designer",
          dateOfBirth: new Date("1994-03-05T00:00:00.000Z"), dateOfJoining: new Date("2020-11-09T00:00:00.000Z"),
          avatarUrl: null, department: { name: "Design" }, user: { avatarUrl: "https://cdn.example/asha.jpg" },
        },
        {
          id: "e2", firstName: "Ben", lastName: null, designation: null,
          dateOfBirth: null, dateOfJoining: new Date("2019-01-01T00:00:00.000Z"),
          avatarUrl: "  ", department: null, user: null,
        },
      ];
    },
  },
});

const employeeService = require("../src/services/employee.service");

describe("celebrations feed", () => {
  it("returns birth month and day but never the birth year or full date of birth", async () => {
    const rows = await employeeService.getCelebrations("org-1", "COMPANY_ADMIN");
    assert.deepEqual([rows[0].birthMonth, rows[0].birthDay], [3, 5]);
    assert.ok(!JSON.stringify(rows).includes("1994"), "the birth year must not be exposed");
    assert.ok(!("dateOfBirth" in rows[0]));
  });

  it("sends the joining date as a plain calendar day", async () => {
    const [first] = await employeeService.getCelebrations("org-1", "COMPANY_ADMIN");
    assert.equal(first.dateOfJoining, "2020-11-09");
  });

  it("uses a real uploaded photo and never invents one", async () => {
    const [first, second] = await employeeService.getCelebrations("org-1", "COMPANY_ADMIN");
    assert.equal(first.photoUrl, "https://cdn.example/asha.jpg");
    assert.equal(second.photoUrl, null);
    assert.equal(second.birthMonth, null);
  });

  it("is limited to the caller's company, to working staff, and to people who have a date", async () => {
    await employeeService.getCelebrations("org-1", "COMPANY_ADMIN");
    assert.equal(lastQuery.where.organizationId, "org-1");
    assert.equal(lastQuery.where.deletedAt, null);
    assert.deepEqual(lastQuery.where.status.in.sort(), ["ACTIVE", "NOTICE_PERIOD", "PROBATION"]);
    assert.ok(lastQuery.where.OR.length === 2);
    assert.equal(lastQuery.take, undefined, "must not be capped to the newest N employees");
  });
});
