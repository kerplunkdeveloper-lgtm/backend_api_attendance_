const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

const state = {
  roleWritten: null,
};

const prisma = {
  employee: {
    findFirst: async () => ({
      id: "emp-a",
      organizationId: "org-a",
      userId: "user-a",
      user: { id: "user-a", role: "EMPLOYEE" },
    }),
  },
  branch: { findFirst: async () => ({ id: "b1" }) },
  department: { findFirst: async () => ({ id: "d1" }) },
  shift: { findFirst: async () => ({ id: "s1" }) },
  async $transaction(fn) {
    return fn({
      user: {
        update: async ({ data }) => {
          state.roleWritten = data.role;
          return data;
        },
      },
      employee: {
        update: async ({ data }) => ({
          id: "emp-a",
          ...data,
          user: { id: "user-a", role: state.roleWritten || "EMPLOYEE" },
        }),
      },
    });
  },
};

mockPrisma(prisma);

const employeeService = require("../src/services/employee.service");
const employeeController = require("../src/controllers/employee.controller");
const { assertRoleAssignment } = require("../src/utils/password");
const { evaluateEntitlement, assertFeature, presentAuthUser } = require("../src/services/entitlement.service");

describe("role assignment", () => {
  it("blocks manager self-promotion and SUPER_ADMIN grants", async () => {
    await assert.rejects(
      () =>
        employeeService.updateEmployee(
          "org-a",
          "emp-a",
          { role: "SUPER_ADMIN" },
          { actorRole: "MANAGER", actorUserId: "mgr-1" },
        ),
      /cannot be assigned/,
    );
    assert.equal(state.roleWritten, null);

    await assert.rejects(
      () =>
        employeeService.updateEmployee(
          "org-a",
          "emp-a",
          { role: "MANAGER" },
          { actorRole: "MANAGER", actorUserId: "user-a" },
        ),
      /cannot change your own role/,
    );

    await assert.rejects(
      () =>
        employeeService.updateEmployee(
          "org-a",
          "emp-a",
          { role: "SUPER_ADMIN" },
          { actorRole: "COMPANY_ADMIN", actorUserId: "admin-1" },
        ),
      /cannot be assigned/,
    );
  });

  it("still allows ordinary profile updates", async () => {
    const updated = await employeeService.updateEmployee(
      "org-a",
      "emp-a",
      { firstName: "Ada" },
      { actorRole: "MANAGER", actorUserId: "mgr-1" },
    );
    assert.equal(updated.firstName, "Ada");
    assert.equal(state.roleWritten, null);
  });

  it("lets a company admin assign MANAGER but not SUPER_ADMIN", () => {
    assert.equal(
      assertRoleAssignment({
        requestedRole: "MANAGER",
        actorRole: "COMPANY_ADMIN",
        actorUserId: "admin-1",
        targetUserId: "user-a",
        targetRole: "EMPLOYEE",
      }),
      "MANAGER",
    );
    assert.throws(
      () =>
        assertRoleAssignment({
          requestedRole: "SUPER_ADMIN",
          actorRole: "COMPANY_ADMIN",
          actorUserId: "admin-1",
          targetUserId: "user-a",
          targetRole: "EMPLOYEE",
        }),
      /cannot be assigned/,
    );
  });

  it("employee update handler returns HTTP 403 for forbidden role changes", async () => {
    const req = {
      params: { id: "emp-a" },
      body: { role: "SUPER_ADMIN" },
      user: { organizationId: "org-a", role: "MANAGER", id: "mgr-1" },
    };
    let statusCode = 0;
    let body = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    await employeeController.update(req, res);
    assert.equal(statusCode, 403);
    assert.equal(body.success, false);
  });
});

describe("subscription entitlement", () => {
  it("rejects an expired canceled organization", () => {
    const result = evaluateEntitlement({
      subscriptionStatus: "CANCELED",
      subscriptionExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    assert.equal(result.allowApp, false);
    assert.equal(result.code, "SUBSCRIPTION_CANCELED");
  });

  it("allows an active subscription before expiry", () => {
    const result = evaluateEntitlement({
      subscriptionStatus: "ACTIVE",
      subscriptionExpiresAt: new Date(Date.now() + 86400000),
    });
    assert.equal(result.allowApp, true);
  });

  it("blocks API access on plans that do not include it", () => {
    assert.throws(
      () =>
        assertFeature(
          { subscriptionPlan: "STARTER", subscription: { hasApiAccess: false } },
          "hasApiAccess",
          "API access",
        ),
      /API access is not included/,
    );
  });

  it("attaches entitlement and plan features to the session user", () => {
    const payload = presentAuthUser({
      id: "u1",
      email: "admin@example.com",
      role: "COMPANY_ADMIN",
      organizationId: "org-a",
      organization: {
        subscriptionPlan: "STARTER",
        subscriptionStatus: "CANCELED",
        subscriptionExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
        subscription: { hasApiAccess: false, hasPayroll: true, maxEmployees: 25, maxBranches: 2 },
      },
    });
    assert.equal(payload.entitlement.allowApp, false);
    assert.equal(payload.features.hasApiAccess, false);
    assert.equal(payload.features.hasPayroll, true);
  });
});
