const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();
mockPrisma({
  billingPlanPrice: { findMany: async () => [{ plan: "ENTERPRISE", billingCycle: "ANNUAL", priceInr: 150000 }] },
  billingPlanLimit: {
    findMany: async () => [
      { id: "741e5c7d-uuid", plan: "ENTERPRISE", maxEmployees: 500, maxBranches: 20, hasGeofence: true, hasPayroll: true, hasShiftPlanner: true, hasApiAccess: true, createdAt: new Date() },
    ],
  },
});
const billing = require("../src/services/billing.service");

describe("plan catalog", () => {
  it("keeps plan ids that checkout accepts, even when a stored limit row exists", async () => {
    const catalog = await billing.getPlanCatalog();
    assert.deepEqual(catalog.map((p) => p.id), ["FREE_TRIAL", "STARTER", "PROFESSIONAL", "ENTERPRISE"]);
  });

  it("still applies the stored limits and prices", async () => {
    const enterprise = (await billing.getPlanCatalog()).find((p) => p.id === "ENTERPRISE");
    assert.equal(enterprise.maxEmployees, 500);
    assert.equal(enterprise.priceAnnual, 150000);
    assert.equal("createdAt" in enterprise, false);
  });
});
