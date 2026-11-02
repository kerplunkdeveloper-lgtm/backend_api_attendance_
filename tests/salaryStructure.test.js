const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let saved;
mockPrisma({
  employee: {
    findFirst: async () => ({ id: "emp-1" }),
  },
  salaryStructure: {
    upsert: async (args) => {
      saved = args;
      return args.create;
    },
  },
});

const payrollService = require("../src/services/payroll.service");

test("salary structure preserves the specialAllowance alias", async () => {
  await payrollService.upsertSalaryStructure("org-1", {
    employeeId: "emp-1",
    annualCtc: 900000,
    monthlyCtc: 75000,
    baseSalary: 37500,
    specialAllowance: 11250,
  });

  assert.equal(saved.create.special, 11250);
  assert.equal(saved.update.special, 11250);
});

test("an explicitly entered zero special allowance remains zero", async () => {
  await payrollService.upsertSalaryStructure("org-1", {
    employeeId: "emp-1",
    annualCtc: 900000,
    monthlyCtc: 75000,
    baseSalary: 37500,
    special: 0,
    specialAllowance: 11250,
  });

  assert.equal(saved.create.special, 0);
});
