const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const person = (id, role, status = "ACTIVE", isActive = true) => ({
  id,
  userId: `u-${id}`,
  status,
  firstName: id.toUpperCase(),
  lastName: null,
  user: { id: `u-${id}`, role, isActive },
});

const people = [
  person("e1", "EMPLOYEE"),
  person("e2", "MANAGER"),
  person("admin", "COMPANY_ADMIN"),
  person("me", "EMPLOYEE"),
  person("off1", "EMPLOYEE", "INACTIVE", false),
  person("off2", "EMPLOYEE", "INACTIVE", false),
  person("gone", "EMPLOYEE", "TERMINATED", false),
];

const state = { employeeWrite: null, userWrite: null, lookupWhere: null, maxEmployees: 100, used: 0 };

const prisma = {
  employee: {
    findMany: async ({ where }) => {
      state.lookupWhere = where;
      return people.filter((p) => where.id.in.includes(p.id));
    },
  },
  async $transaction(fn) {
    return fn({
      organization: { findUnique: async () => ({ id: "org-a", maxEmployees: state.maxEmployees }) },
      employee: {
        count: async () => state.used,
        updateMany: async (args) => (state.employeeWrite = args),
      },
      user: { updateMany: async (args) => (state.userWrite = args) },
    });
  },
};
mockPrisma(prisma);

const employeeService = require("../src/services/employee.service");

const asAdmin = { userId: "u-me", role: "COMPANY_ADMIN" };

describe("bulk employee login access", () => {
  beforeEach(() => {
    Object.assign(state, { employeeWrite: null, userWrite: null, lookupWhere: null, maxEmployees: 100, used: 0 });
  });

  it("deactivates logins, keeps records, and scopes everything to the organization", async () => {
    const result = await employeeService.setEmployeesAccess("org-a", ["e1", "e2", "e1"], "DEACTIVATE", asAdmin);

    assert.equal(result.changedCount, 2);
    assert.equal(state.lookupWhere.organizationId, "org-a");
    assert.equal(state.lookupWhere.deletedAt, null);
    assert.deepEqual(state.employeeWrite.where.id.in, ["e1", "e2"]);
    assert.equal(state.employeeWrite.where.organizationId, "org-a");
    assert.deepEqual(state.employeeWrite.data, { status: "INACTIVE" }); // not deleted
    assert.deepEqual(state.userWrite.where.id.in, ["u-e1", "u-e2"]);
    assert.deepEqual(state.userWrite.data, { isActive: false });
  });

  it("protects your own account, admins (unless super admin) and unknown or already-off ids", async () => {
    const result = await employeeService.setEmployeesAccess(
      "org-a",
      ["e1", "me", "admin", "off1", "missing"],
      "DEACTIVATE",
      asAdmin,
    );

    assert.equal(result.changedCount, 1);
    const reasons = Object.fromEntries(result.failed.map((f) => [f.id, f.reason]));
    assert.match(reasons.me, /own account/);
    assert.match(reasons.admin, /super admin/);
    assert.match(reasons.off1, /Already deactivated/);
    assert.match(reasons.missing, /not found/);

    const bySuper = await employeeService.setEmployeesAccess("org-a", ["admin"], "DEACTIVATE", { userId: "x", role: "SUPER_ADMIN" });
    assert.equal(bySuper.changedCount, 1);
  });

  it("reactivates logins as ACTIVE and refuses terminated or already-active people", async () => {
    const result = await employeeService.setEmployeesAccess("org-a", ["off1", "off2", "gone", "e1"], "ACTIVATE", asAdmin);

    assert.equal(result.changedCount, 2);
    assert.deepEqual(state.employeeWrite.data, { status: "ACTIVE" });
    assert.deepEqual(state.userWrite.data, { isActive: true });
    const reasons = Object.fromEntries(result.failed.map((f) => [f.id, f.reason]));
    assert.match(reasons.gone, /Terminated/);
    assert.match(reasons.e1, /Already active/);
  });

  it("only reactivates as many people as the plan has free seats", async () => {
    state.maxEmployees = 5;
    state.used = 4;
    const result = await employeeService.setEmployeesAccess("org-a", ["off1", "off2"], "ACTIVATE", asAdmin);

    assert.equal(result.changedCount, 1);
    assert.deepEqual(state.employeeWrite.where.id.in, ["off1"]);
    assert.match(result.failed[0].reason, /limit reached/);
  });

  it("writes nothing when every selection is protected, and validates input", async () => {
    await employeeService.setEmployeesAccess("org-a", ["me"], "DEACTIVATE", asAdmin);
    assert.equal(state.employeeWrite, null);

    const bad = (fn) => assert.rejects(fn, (e) => e.statusCode === 400);
    await bad(() => employeeService.setEmployeesAccess("org-a", [], "DEACTIVATE", asAdmin));
    await bad(() => employeeService.setEmployeesAccess("org-a", "e1", "DEACTIVATE", asAdmin));
    await bad(() => employeeService.setEmployeesAccess("org-a", ["e1"], "DELETE", asAdmin));
    await bad(() =>
      employeeService.setEmployeesAccess("org-a", Array.from({ length: 201 }, (_, i) => `x${i}`), "DEACTIVATE", asAdmin),
    );
  });
});
