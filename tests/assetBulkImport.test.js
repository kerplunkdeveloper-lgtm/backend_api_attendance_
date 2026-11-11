const test = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const createdAssets = [];
const assignments = [];
const prisma = mockPrisma({
  asset: {
    findMany: async ({ where }) => (where.assetCode ? [] : []),
    findUnique: async () => null,
    findFirst: async () => ({ id: "employee-1", status: "ACTIVE" }),
    create: async ({ data }) => {
      const asset = { id: `asset-${createdAssets.length + 1}`, ...data };
      createdAssets.push(asset);
      return asset;
    },
    count: async () => 0,
  },
  employee: {
    findMany: async () => [{ id: "employee-1", employeeCode: "EMP001", status: "ACTIVE" }],
    findFirst: async () => ({ id: "employee-1", status: "ACTIVE" }),
    findUnique: async () => ({ id: "employee-1", user: null }),
  },
  assetAssignment: {
    create: async ({ data }) => {
      assignments.push(data);
      return data;
    },
  },
});

const assetService = require("../src/services/asset.service");

test("bulk asset import creates assets and custody assignments for employee codes", async () => {
  createdAssets.length = 0;
  assignments.length = 0;

  const result = await assetService.bulkCreateAssets("org-1", [
    {
      assetCode: "LAP-01001",
      name: "MacBook Pro 14",
      category: "LAPTOP",
      employeeCode: "EMP001",
      condition: "NEW",
    },
    {
      assetCode: "MON-01001",
      name: "Dell Monitor",
      category: "MONITOR",
      employeeCode: "EMP001",
      condition: "GOOD",
    },
  ], { email: "hr@example.com" });

  assert.equal(result.count, 2);
  assert.equal(createdAssets.length, 2);
  assert.equal(assignments.length, 2);
  assert.deepEqual(assignments.map((item) => item.employeeId), ["employee-1", "employee-1"]);
  assert.deepEqual(createdAssets.map((item) => item.status), ["ASSIGNED", "ASSIGNED"]);
});

test("bulk asset import rejects an unknown employee code before creating anything", async () => {
  const originalEmployeeFindMany = prisma.employee.findMany;
  prisma.employee.findMany = async () => [];
  const before = createdAssets.length;

  await assert.rejects(
    assetService.bulkCreateAssets("org-1", [{
      assetCode: "LAP-01002",
      name: "ThinkPad",
      category: "LAPTOP",
      employeeCode: "UNKNOWN",
    }], { email: "hr@example.com" }),
    /employee code 'UNKNOWN' was not found/i,
  );

  assert.equal(createdAssets.length, before);
  prisma.employee.findMany = originalEmployeeFindMany;
});

test("bulk asset import rejects duplicate asset codes", async () => {
  await assert.rejects(
    assetService.bulkCreateAssets("org-1", [
      { assetCode: "LAP-01003", name: "Laptop A", category: "LAPTOP", employeeCode: "EMP001" },
      { assetCode: "LAP-01003", name: "Laptop B", category: "LAPTOP", employeeCode: "EMP001" },
    ], { email: "hr@example.com" }),
    /same asset code appears more than once/i,
  );
});
