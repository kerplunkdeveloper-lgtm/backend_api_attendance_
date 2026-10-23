const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

let updates;
let creates;

mockPrisma({
  billingOffer: {
    findUnique: async ({ where }) =>
      where.id === "missing" ? null : { id: where.id, code: "FESTIVE25", type: "PERCENTAGE", value: 25, startsAt: null, expiresAt: null },
    update: async ({ where, data }) => {
      updates.push({ where, data });
      return { id: where.id, code: "FESTIVE25", label: "Festive", type: "PERCENTAGE", value: 25, eligiblePlans: [], eligibleCycles: [], ...data };
    },
    create: async ({ data }) => {
      creates.push(data);
      return { id: "offer-1", ...data };
    },
  },
});

const billingAdmin = require("../src/services/billing-admin.service");

describe("billing offers (platform admin)", () => {
  beforeEach(() => {
    updates = [];
    creates = [];
  });

  it("creates an offer with a normalised code", async () => {
    await billingAdmin.createOffer(
      { code: "festive25", label: "Festive 25", type: "PERCENTAGE", value: 25, eligiblePlans: ["PROFESSIONAL"] },
      "owner-1",
    );

    assert.equal(creates[0].code, "FESTIVE25");
    assert.deepEqual(creates[0].eligiblePlans, ["PROFESSIONAL"]);
  });

  it("lets an offer be switched off by sending only isActive", async () => {
    await billingAdmin.updateOffer("offer-1", { isActive: false }, "owner-1");

    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.isActive, false);
  });

  it("updates only the fields that were sent", async () => {
    await billingAdmin.updateOffer("offer-1", { value: 30 }, "owner-1");

    assert.deepEqual(Object.keys(updates[0].data).sort(), ["updatedByUserId", "value"]);
    assert.equal(updates[0].data.value, 30);
  });

  it("still validates the fields that are sent", async () => {
    await assert.rejects(() => billingAdmin.updateOffer("offer-1", { value: 150, type: "PERCENTAGE" }, "owner-1"), /Offer value is invalid/);
    await assert.rejects(() => billingAdmin.updateOffer("offer-1", { eligiblePlans: ["GOLD"] }, "owner-1"), /invalid plan/);
    await assert.rejects(() => billingAdmin.updateOffer("offer-1", { code: "no spaces!" }, "owner-1"), /Offer code must be/);
    assert.equal(updates.length, 0);
  });

  it("checks a new value against the stored offer type when only the value is sent", async () => {
    await assert.rejects(() => billingAdmin.updateOffer("offer-1", { value: 150 }, "owner-1"), /Offer value is invalid/);
    assert.equal(updates.length, 0);
  });

  it("reports an unknown offer as 404 instead of failing in the database", async () => {
    await assert.rejects(() => billingAdmin.updateOffer("missing", { isActive: false }, "owner-1"), (error) => {
      assert.equal(error.statusCode, 404);
      return true;
    });
  });

  it("rejects an expiry that is before the start", async () => {
    await assert.rejects(
      () => billingAdmin.updateOffer("offer-1", { startsAt: "2026-12-01T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z" }, "owner-1"),
      /expiry must be after/,
    );
  });
});
