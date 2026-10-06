const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const LATENCY_MS = 40; // simulated database round-trip
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = { users: [], employees: [], queries: 0, maxEmployees: 100, used: 0, newDepts: [], newBranches: [], branchCount: 0 };

const counted = (fn) => async (...args) => {
  state.queries += 1;
  await sleep(LATENCY_MS);
  return fn(...args);
};

const prisma = {
  organization: { findUnique: counted(async () => ({ name: "Acme" })) },
  branch: { findMany: counted(async () => [{ id: "b1", name: "HQ" }]) },
  department: { findMany: counted(async () => [{ id: "d1", name: "Sales" }]) },
  shift: { findMany: counted(async () => [{ id: "s1", name: "Day" }]) },
  user: { findMany: counted(async () => [{ email: "dup@acme.test" }]) },
  employee: { findMany: counted(async () => []) },
  async $transaction(fn) {
    return fn({
      organization: {
        findUnique: counted(async () => ({ id: "org-a", maxEmployees: state.maxEmployees })),
      },
      department: {
        createMany: counted(async ({ data }) => {
          state.newDepts.push(...data.map((d) => d.name));
          return { count: data.length };
        }),
        findMany: counted(async ({ where }) => where.name.in.map((name) => ({ id: `dept-${name}`, name }))),
      },
      branch: {
        count: counted(async () => state.branchCount),
        createMany: counted(async ({ data }) => {
          state.newBranches.push(...data.map((d) => d.name));
          return { count: data.length };
        }),
        findMany: counted(async ({ where }) => where.name.in.map((name) => ({ id: `branch-${name}`, name }))),
      },
      user: {
        createManyAndReturn: counted(async ({ data }) => {
          state.users.push(...data);
          return data.map((d, i) => ({ id: `u${state.users.length - data.length + i}`, email: d.email, avatarUrl: d.avatarUrl }));
        }),
      },
      employee: {
        count: counted(async () => state.used),
        createMany: counted(async ({ data }) => {
          state.employees.push(...data);
          return { count: data.length };
        }),
      },
    });
  },
};
mockPrisma(prisma);

const employeeService = require("../src/services/employee.service");

describe("bulk employee import", () => {
  beforeEach(() => {
    Object.assign(state, { users: [], employees: [], queries: 0, maxEmployees: 100, used: 0, newDepts: [], newBranches: [], branchCount: 0 });
  });

  it("imports valid rows, reports invalid and duplicate rows, and never grants admin roles", async () => {
    const result = await employeeService.bulkImportEmployees(
      "org-a",
      [
        { firstName: "Asha", email: "Asha@Acme.test", department: "sales", role: "SUPER_ADMIN" },
        { firstName: "", email: "x@acme.test" },
        { firstName: "Dup", email: "dup@acme.test" },
        { firstName: "NoMail" },
        { firstName: "Asha Again", email: "asha@acme.test" },
        null,
      ],
      "COMPANY_ADMIN",
    );

    assert.equal(result.total, 6);
    assert.equal(result.importedCount, 1);
    assert.equal(result.failedCount, 5);
    assert.equal(state.users[0].email, "asha@acme.test");
    assert.equal(state.users[0].role, "EMPLOYEE");
    assert.equal(state.users[0].mustChangePassword, true);
    assert.equal(state.employees[0].departmentId, "d1");
    assert.deepEqual(
      result.results.map((r) => r.row),
      [1, 2, 3, 4, 5, 6],
    );
    // The UI reads its summary from `data`.
    assert.equal(result.data.importedCount, 1);
    assert.equal(result.data.failed.length, 5);
  });

  it("uses a constant number of queries and finishes fast for a full batch", async () => {
    state.maxEmployees = 1000;
    const rows = Array.from({ length: 200 }, (_, i) => ({ firstName: `Emp${i}`, email: `emp${i}@acme.test` }));
    const started = Date.now();
    const result = await employeeService.bulkImportEmployees("org-a", rows, "COMPANY_ADMIN");
    const elapsed = Date.now() - started;

    assert.equal(result.importedCount, 200);
    assert.ok(state.queries <= 12, `expected a constant query count, got ${state.queries}`);
    // The per-row design would need 200 rows * ~8 round-trips * 40ms = 64s.
    assert.ok(elapsed < 15000, `import took ${elapsed}ms`);
  });

  it("links existing departments/branches and creates the ones the file introduces", async () => {
    const result = await employeeService.bulkImportEmployees(
      "org-a",
      [
        { firstName: "Ravi", email: "ravi@acme.test", department: " SALES ", branch: "hq" },
        { firstName: "Meena", email: "meena@acme.test", department: "Operations", branch: "Pune" },
        { firstName: "Karan", email: "karan@acme.test", department: "operations", branch: "pune" },
        { firstName: "Divya", email: "divya@acme.test" },
      ],
      "COMPANY_ADMIN",
    );

    assert.equal(result.importedCount, 4);
    assert.deepEqual(state.newDepts, ["Operations"]);
    assert.deepEqual(state.newBranches, ["Pune"]);
    assert.deepEqual(result.createdDepartments, ["Operations"]);
    assert.deepEqual(result.createdBranches, ["Pune"]);

    const byCode = (email) => state.employees.find((e) => e.workEmail === email);
    assert.equal(byCode("ravi@acme.test").departmentId, "d1");
    assert.equal(byCode("ravi@acme.test").branchId, "b1");
    assert.equal(byCode("meena@acme.test").departmentId, "dept-Operations");
    assert.equal(byCode("karan@acme.test").departmentId, "dept-Operations");
    assert.equal(byCode("karan@acme.test").branchId, "branch-Pune");
    // A blank cell uses the workspace default, not a created record.
    assert.equal(byCode("divya@acme.test").departmentId, "d1");
    assert.equal(byCode("divya@acme.test").branchId, "b1");
  });

  it("falls back to the default branch with a warning when the plan's branch limit is hit", async () => {
    state.branchCount = 1000;
    const result = await employeeService.bulkImportEmployees(
      "org-a",
      [{ firstName: "Meena", email: "meena@acme.test", branch: "Pune" }],
      "COMPANY_ADMIN",
    );

    assert.equal(result.importedCount, 1);
    assert.deepEqual(state.newBranches, []);
    assert.equal(state.employees[0].branchId, "b1");
    assert.match(result.warnings[0], /Branch limit reached/);
  });

  it("stops at the plan's seat limit and reports the rest", async () => {
    state.maxEmployees = 3;
    state.used = 1;
    const rows = Array.from({ length: 4 }, (_, i) => ({ firstName: `E${i}`, email: `e${i}@acme.test` }));
    const result = await employeeService.bulkImportEmployees("org-a", rows, "COMPANY_ADMIN");

    assert.equal(result.importedCount, 2);
    assert.equal(result.failedCount, 2);
    assert.match(result.failed[0].reason, /limit reached/);
  });

  it("rejects empty and oversized batches with a 400", async () => {
    await assert.rejects(() => employeeService.bulkImportEmployees("org-a", []), (e) => e.statusCode === 400);
    const big = Array.from({ length: 201 }, (_, i) => ({ firstName: "A", email: `a${i}@x.test` }));
    await assert.rejects(() => employeeService.bulkImportEmployees("org-a", big), (e) => e.statusCode === 400);
  });
});
