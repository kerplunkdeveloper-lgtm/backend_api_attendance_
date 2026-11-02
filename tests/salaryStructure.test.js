const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let saved;
let savedRevision;
mockPrisma({
  employee: {
    findFirst: async () => ({ id: "emp-1" }),
  },
  salaryStructure: {
    findFirst: async () => null,
    upsert: async (args) => {
      saved = args;
      return args.create;
    },
  },
  salaryRevision: {
    create: async (args) => {
      savedRevision = args;
      return args.data;
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

test("salary revisions preserve the specialAllowance alias", async () => {
  await payrollService.recordSalaryRevision("org-1", {
    employeeId: "emp-1",
    annualCtc: 960000,
    monthlyCtc: 80000,
    baseSalary: 40000,
    specialAllowance: 12000,
  }, "admin-1");

  assert.equal(savedRevision.data.special, 12000);
  assert.equal(saved.create.special, 12000);
});

test("salary revisions keep an explicitly entered zero special allowance", async () => {
  await payrollService.recordSalaryRevision("org-1", {
    employeeId: "emp-1",
    annualCtc: 960000,
    monthlyCtc: 80000,
    baseSalary: 40000,
    special: 0,
    specialAllowance: 12000,
  }, "admin-1");

  assert.equal(savedRevision.data.special, 0);
  assert.equal(saved.create.special, 0);
});
