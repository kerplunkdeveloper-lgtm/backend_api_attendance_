const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let shift;
let updateArgs;
let updateCount;

const prisma = mockPrisma({
  shift: {
    findFirst: async ({ where }) => {
      if (where.id !== "shift-1" || where.organizationId !== "org-1") return null;
      return shift;
    },
  },
  employee: {
    updateMany: async (args) => {
      updateArgs = args;
      return { count: updateCount };
    },
  },
});

const { removeEmployeeFromShift } = require("../src/services/shift.service");

test.beforeEach(() => {
  shift = { id: "shift-1", name: "General Shift" };
  updateArgs = null;
  updateCount = 1;
});

test("removes only the employee assigned to the selected tenant shift", async () => {
  const result = await removeEmployeeFromShift("org-1", "shift-1", "employee-1");

  assert.equal(result.count, 1);
  assert.deepEqual(updateArgs.where, {
    id: "employee-1",
    organizationId: "org-1",
    shiftId: "shift-1",
  });
  assert.deepEqual(updateArgs.data, {
    shiftId: null,
    flexiblePunching: false,
  });
});

test("returns a not-found error when the employee is not assigned to that shift", async () => {
  updateCount = 0;

  await assert.rejects(
    () => removeEmployeeFromShift("org-1", "shift-1", "employee-1"),
    (error) => error.statusCode === 404 && /not assigned/i.test(error.message),
  );
});

test("does not update employees when the shift belongs to another tenant", async () => {
  await assert.rejects(
    () => removeEmployeeFromShift("org-2", "shift-1", "employee-1"),
    /Shift not found in this organization/,
  );
  assert.equal(updateArgs, null);
});
