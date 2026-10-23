const test = require("node:test");
const assert = require("node:assert/strict");
const { WORKING_STATUSES, workingStaff } = require("../src/utils/employeeStatus");

test("employees serving notice or on probation still count as working staff", () => {
  for (const status of ["ACTIVE", "PROBATION", "NOTICE_PERIOD"]) assert.ok(WORKING_STATUSES.includes(status), status);
});

test("people who have left are never working staff", () => {
  for (const status of ["INACTIVE", "TERMINATED"]) assert.ok(!WORKING_STATUSES.includes(status), status);
});

test("workingStaff is a ready-to-spread Prisma filter", () => {
  assert.deepEqual(workingStaff, { status: { in: WORKING_STATUSES } });
});
