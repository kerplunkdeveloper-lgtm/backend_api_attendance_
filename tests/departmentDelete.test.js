const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const calls = [];
const tx = {
  designation: { deleteMany: async (args) => calls.push(["designation.deleteMany", args]) },
  employee: { updateMany: async (args) => calls.push(["employee.updateMany", args]) },
  onboardingCandidate: { updateMany: async (args) => calls.push(["candidate.updateMany", args]) },
  department: { delete: async (args) => calls.push(["department.delete", args]) },
};

mockPrisma({
  department: { findFirst: async () => ({ id: "dept-default", organizationId: "org-1", name: "IT" }) },
  $transaction: async (callback) => callback(tx),
});

const departmentService = require("../src/services/department.service");

describe("department deletion", () => {
  it("cleans linked titles and assignments before deleting a seeded department", async () => {
    calls.length = 0;
    await departmentService.deleteDepartment("org-1", "dept-default");

    assert.deepEqual(calls.map(([name]) => name), [
      "designation.deleteMany",
      "employee.updateMany",
      "candidate.updateMany",
      "department.delete",
    ]);
    assert.deepEqual(calls[0][1].where, { departmentId: "dept-default", organizationId: "org-1" });
    assert.deepEqual(calls[1][1].data, { departmentId: null });
    assert.deepEqual(calls[2][1].data, { departmentId: null });
    assert.deepEqual(calls[3][1], { where: { id: "dept-default" } });
  });
});
