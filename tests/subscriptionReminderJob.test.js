const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma } = require("./helpers/mockPrisma");

const NOW = new Date("2026-10-23T06:00:00Z");
const inDays = (n) => new Date(NOW.getTime() + n * 86400000);

let orgs;
let stored;
let created;
let emails;
let failEmail;

mockPrisma({
  organization: { findMany: async () => orgs },
  user: {
    findMany: async ({ where }) => {
      assert.equal(where.role, "COMPANY_ADMIN");
      assert.equal(where.isActive, true);
      return [{ id: "admin-1", email: "a@x.test" }, { id: "admin-2", email: "b@x.test" }];
    },
  },
  notification: {
    findMany: async () => stored,
    createMany: async ({ data }) => {
      created.push(...data);
      return { count: data.length };
    },
  },
});
const emailPath = require.resolve("../src/services/email.service");
require.cache[emailPath] = {
  id: emailPath,
  filename: emailPath,
  loaded: true,
  exports: {
    sendSubscriptionReminderEmail: async (to, payload) => {
      if (failEmail) throw new Error("smtp down");
      emails.push({ to, payload });
    },
  },
};

const { sendSubscriptionReminders } = require("../src/services/subscriptionReminder.service");

const trialOrg = (days) => ({
  id: "org-1",
  name: "Acme",
  logoUrl: null,
  subscriptionPlan: "FREE_TRIAL",
  subscriptionStatus: "TRIALING",
  subscriptionExpiresAt: inDays(days),
  trialEndsAt: inDays(days),
  subscription: null,
});

beforeEach(() => {
  orgs = [trialOrg(3)];
  stored = [];
  created = [];
  emails = [];
  failEmail = false;
});

describe("subscription reminder job", () => {
  it("notifies and emails every company admin once the trial is close to ending", async () => {
    const result = await sendSubscriptionReminders(NOW);
    assert.equal(result.reminded, 2);
    assert.deepEqual(created.map((n) => [n.userId, n.type, n.title]), [
      ["admin-1", "BILLING", "Your free trial ends in 3 days"],
      ["admin-2", "BILLING", "Your free trial ends in 3 days"],
    ]);
    assert.deepEqual(emails.map((e) => e.to), ["a@x.test", "b@x.test"]);
    assert.equal(emails[0].payload.urgent, true);
  });

  it("does not repeat a reminder an admin already has, and only fills in the one who is missing it", async () => {
    await sendSubscriptionReminders(NOW);
    stored = [{ userId: "admin-1", message: created[0].message }];
    created = [];
    emails = [];
    const result = await sendSubscriptionReminders(NOW);
    assert.equal(result.reminded, 1);
    assert.deepEqual(created.map((n) => n.userId), ["admin-2"]);
    assert.deepEqual(emails.map((e) => e.to), ["b@x.test"]);
  });

  it("stays quiet when the trial is still far off", async () => {
    orgs = [trialOrg(20)];
    const result = await sendSubscriptionReminders(NOW);
    assert.equal(result.reminded, 0);
    assert.equal(created.length, 0);
  });

  it("keeps the in-app notice and finishes the run when email fails", async () => {
    failEmail = true;
    const result = await sendSubscriptionReminders(NOW);
    assert.equal(result.reminded, 2);
    assert.equal(created.length, 2);
  });

  it("prefers the subscription record over the organization row, like the access check does", async () => {
    orgs = [{ ...trialOrg(40), subscriptionStatus: "ACTIVE", subscription: { status: "ACTIVE", plan: "PROFESSIONAL", currentPeriodEnd: inDays(1) } }];
    await sendSubscriptionReminders(NOW);
    assert.match(created[0].title, /Professional plan expires in 1 day/);
  });
});
