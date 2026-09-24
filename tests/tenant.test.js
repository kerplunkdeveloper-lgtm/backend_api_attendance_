const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

mockPrisma({
  employee: {
    findFirst: async () => null,
  },
});

const employeeService = require("../src/services/employee.service");

describe("tenant isolation", () => {
  it("returns not found when an employee id belongs to another organization", async () => {
    await assert.rejects(
      () => employeeService.getEmployeeById("org-a", "foreign-employee-id"),
      /Employee not found/
    );
  });
});
