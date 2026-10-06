const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY);

const org = (over) => ({
  id: over.id,
  name: over.name,
  email: `${over.id}@x.test`,
  createdAt: ago(90),
  planLocked: false,
  suspendedAt: null,
  subscriptionPlan: "STARTER",
  subscriptionStatus: "ACTIVE",
  maxEmployees: 25,
  subscription: { plan: "STARTER", status: "ACTIVE", maxEmployees: 25 },
  users: [{ email: `admin@${over.id}.test` }],
  _count: { employees: 5 },
  ...over,
});

const orgs = [
  org({ id: "healthy", name: "Healthy Co" }),
  org({ id: "full", name: "Nearly Full Co", _count: { employees: 24 } }),
  org({ id: "late", name: "Late Payer", subscriptionStatus: "PAST_DUE", subscription: { plan: "STARTER", status: "PAST_DUE", maxEmployees: 25 } }),
  org({ id: "idle", name: "Idle Co" }),
  org({ id: "newbie", name: "Just Joined", createdAt: ago(2) }),
  org({ id: "locked", name: "Locked Co", planLocked: true, createdAt: ago(10) }),
  org({ id: "paused", name: "Paused Co", suspendedAt: ago(4), _count: { employees: 25 } }),
  org({ id: "trial", name: "Trial Co", subscriptionPlan: "FREE_TRIAL", subscriptionStatus: "TRIALING", subscription: { plan: "FREE_TRIAL", status: "TRIALING", maxEmployees: 10 }, maxEmployees: 10, planLocked: true }),
];
const logins = [
  { organizationId: "healthy", _max: { lastLoginAt: ago(1) } },
  { organizationId: "full", _max: { lastLoginAt: ago(2) } },
  { organizationId: "late", _max: { lastLoginAt: ago(3) } },
  { organizationId: "idle", _max: { lastLoginAt: ago(45) } },
  { organizationId: "locked", _max: { lastLoginAt: ago(1) } },
  { organizationId: "paused", _max: { lastLoginAt: ago(1) } },
  { organizationId: "trial", _max: { lastLoginAt: ago(1) } },
];

mockPrisma({
  organization: { findMany: async () => orgs },
  user: { groupBy: async () => logins },
});

const { attention } = require("../src/services/platform-admin.service");

describe("owner attention list", () => {
  it("groups clients by what the owner should act on", async () => {
    const a = await attention();
    assert.deepEqual(a.pastDue.items.map((c) => c.name), ["Late Payer"]);
    assert.deepEqual(a.seatLimit.items.map((c) => c.name), ["Nearly Full Co"]);
    assert.equal(a.seatLimit.items[0].pct, 96);
    assert.deepEqual(a.inactive.items.map((c) => c.name), ["Idle Co"]);
    assert.deepEqual(a.awaitingUnlock.items.map((c) => c.name), ["Locked Co"]);
    assert.deepEqual(a.suspended.items.map((c) => c.name), ["Paused Co"]);
  });

  it("does not flag healthy, brand-new or trial workspaces", async () => {
    const a = await attention();
    const flagged = new Set(["pastDue", "seatLimit", "inactive", "awaitingUnlock", "suspended"].flatMap((k) => a[k].items.map((c) => c.name)));
    assert.equal(flagged.has("Healthy Co"), false);
    assert.equal(flagged.has("Just Joined"), false);
    assert.equal(flagged.has("Trial Co"), false);
  });

  it("does not also chase a suspended client for seats", async () => {
    const a = await attention();
    assert.equal(a.seatLimit.items.some((c) => c.name === "Paused Co"), false);
    assert.equal(a.total, 5);
  });
});
