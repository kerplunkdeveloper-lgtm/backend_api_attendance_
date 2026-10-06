const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();
let lastWhere = null;
mockPrisma({
  organization: {
    findMany: async (args) => {
      lastWhere = args.where;
      return [];
    },
    count: async () => 0,
  },
});

const { monthlyValue, listClients } = require("../src/services/platform-admin.service");

describe("platform admin console", () => {
  it("counts only active paid subscriptions toward MRR, normalising annual plans", () => {
    assert.equal(monthlyValue({ status: "ACTIVE", plan: "STARTER", billingCycle: "MONTHLY", price: 2499 }), 2499);
    assert.equal(monthlyValue({ status: "ACTIVE", plan: "PROFESSIONAL", billingCycle: "ANNUAL", price: 72000 }), 6000);
    assert.equal(monthlyValue({ status: "TRIALING", plan: "STARTER", billingCycle: "MONTHLY", price: 2499 }), 0);
    assert.equal(monthlyValue({ status: "ACTIVE", plan: "FREE_TRIAL", billingCycle: "MONTHLY", price: 0 }), 0);
    assert.equal(monthlyValue({ status: "EXPIRED", plan: "STARTER", billingCycle: "MONTHLY", price: 2499 }), 0);
    assert.equal(monthlyValue(null), 0);
  });

  it("never lists deleted workspaces and ignores unknown filter values", async () => {
    await listClients({ plan: "NOT_A_PLAN", status: "nope", search: "  acme " });
    assert.equal(lastWhere.deletedAt, null);
    assert.deepEqual(lastWhere.users, { none: { role: "SUPER_ADMIN" } });
    assert.equal(lastWhere.subscriptionPlan, undefined);
    assert.equal(lastWhere.subscriptionStatus, undefined);
    assert.equal(lastWhere.OR[0].name.contains, "acme");
  });

  it("is mounted behind the SUPER_ADMIN-only guard", () => {
    const fs = require("node:fs");
    const src = fs.readFileSync(require.resolve("../src/routes/platform-admin.routes.js"), "utf8");
    assert.match(src, /authorizeRoles\("SUPER_ADMIN"\)/);
    assert.doesNotMatch(src, /COMPANY_ADMIN|MANAGER|EMPLOYEE/);
  });
});

describe("workspace suspension", () => {
  const { evaluateEntitlement } = require("../src/services/entitlement.service");
  const active = { subscriptionStatus: "ACTIVE", subscription: { status: "ACTIVE", plan: "STARTER", currentPeriodEnd: new Date(Date.now() + 86400000 * 20) } };

  it("blocks a suspended workspace even when its subscription is active", () => {
    const result = evaluateEntitlement({ ...active, suspendedAt: new Date() });
    assert.equal(result.allowApp, false);
    assert.equal(result.code, "ACCOUNT_SUSPENDED");
    assert.match(result.message, /suspended/i);
  });

  it("lets the same workspace in once the suspension is cleared", () => {
    assert.equal(evaluateEntitlement({ ...active, suspendedAt: null }).allowApp, true);
  });

  it("does not expose the internal suspension reason to tenants", () => {
    const { organizationSelect } = require("../src/utils/prismaSelects");
    assert.equal(organizationSelect.suspendedAt, true);
    assert.equal(organizationSelect.suspendReason, undefined);
  });

  it("hides platform-owner actions from the tenant audit trail", async () => {
    let where;
    mockPrisma({
      auditLog: {
        findMany: async (args) => {
          where = args.where;
          return [];
        },
        count: async () => 0,
      },
    });
    delete require.cache[require.resolve("../src/services/audit.service")];
    await require("../src/services/audit.service").getAuditLogs("org-1", { entity: "PLATFORM" });
    assert.deepEqual(where.entity, { not: "PLATFORM" });
  });
});
