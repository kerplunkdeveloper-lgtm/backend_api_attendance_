const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();
mockPrisma({});

const billing = require("../src/services/billing.service");

let current;
let written;

const tx = {
  organization: {
    findUnique: async () => current,
    update: async ({ data }) => {
      written = data;
      return data;
    },
  },
  subscription: { upsert: async () => ({}) },
};

const PAID_AT = new Date("2026-10-23T00:00:00Z");
const run = (plan, extend) => billing.applyPaidPlan("org-1", plan, "ANNUAL", { tx, periodStart: PAID_AT, extendFromCurrent: extend });

beforeEach(() => {
  written = null;
  current = { subscriptionPlan: "PROFESSIONAL", subscriptionStatus: "ACTIVE", subscriptionExpiresAt: new Date("2027-01-10T00:00:00Z") };
});

describe("renewing before the plan expires", () => {
  it("adds the new year after the current end date, so paid days are kept", async () => {
    const end = await run("PROFESSIONAL", true);
    assert.equal(end.toISOString().slice(0, 10), "2028-01-10");
    assert.equal(written.subscriptionExpiresAt.toISOString().slice(0, 10), "2028-01-10");
  });

  it("starts from today when the plan already ran out", async () => {
    current.subscriptionExpiresAt = new Date("2026-09-01T00:00:00Z");
    const end = await run("PROFESSIONAL", true);
    assert.equal(end.toISOString().slice(0, 10), "2027-10-23");
  });

  it("starts a fresh period when switching to a different plan", async () => {
    const end = await run("ENTERPRISE", true);
    assert.equal(end.toISOString().slice(0, 10), "2027-10-23");
  });

  it("does not stack time for a free (100% off) order", async () => {
    const end = await run("PROFESSIONAL", false);
    assert.equal(end.toISOString().slice(0, 10), "2027-10-23");
  });

  it("a canceled plan that is still inside its paid period is extended too", async () => {
    current.subscriptionStatus = "CANCELED";
    const end = await run("PROFESSIONAL", true);
    assert.equal(end.toISOString().slice(0, 10), "2028-01-10");
  });
});
