const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

// Every model answers findMany/count; the test only looks at the paging the
// service asked the database for.
let seen;
mockPrisma(
  new Proxy(
    {},
    {
      get: (_, model) => ({
        findMany: async (args) => {
          seen.push({ model, take: args.take, skip: args.skip });
          return [];
        },
        count: async () => 0,
      }),
    },
  ),
);

const attendance = require("../src/services/attendance.service");
const leave = require("../src/services/leave.service");
const audit = require("../src/services/audit.service");
const correction = require("../src/services/correction.service");
const overtime = require("../src/services/overtime.service");

const lists = {
  "team attendance": (q) => attendance.getAllAttendance("org-1", q),
  "attendance history": (q) => attendance.getAttendanceHistory({ userId: "u-1", organizationId: "org-1", role: "COMPANY_ADMIN", ...q }),
  "leave requests": (q) => leave.getAllLeaveRequests("org-1", q),
  "audit logs": (q) => audit.getAuditLogs("org-1", q),
  "attendance corrections": (q) => correction.getAllRequests("org-1", q),
  "overtime requests": (q) => overtime.getOvertimeRequests("org-1", q),
};

const pagingOf = () => seen.find((call) => call.take !== undefined);

describe("list endpoint paging", () => {
  beforeEach(() => {
    seen = [];
  });

  for (const [name, run] of Object.entries(lists)) {
    it(`${name}: caps an oversized page so one request cannot pull the whole table`, async () => {
      await run({ limit: "1000000", page: "1" });
      assert.equal(pagingOf().take, 500);
    });

    it(`${name}: turns a negative limit or page into a safe one`, async () => {
      // A negative take would read backwards from the end, and a negative skip is a database error.
      await run({ limit: "-5", page: "-3" });
      assert.equal(pagingOf().take, 1);
      assert.equal(pagingOf().skip, 0);
    });

    it(`${name}: falls back to its default for junk and honours a normal page`, async () => {
      await run({ limit: "abc", page: "x" });
      assert.ok(pagingOf().take >= 20 && pagingOf().take <= 50, `default page size was ${pagingOf().take}`);
      assert.equal(pagingOf().skip, 0);

      seen = [];
      await run({ limit: "25", page: "3" });
      assert.equal(pagingOf().take, 25);
      assert.equal(pagingOf().skip, 50);
    });
  }
});
