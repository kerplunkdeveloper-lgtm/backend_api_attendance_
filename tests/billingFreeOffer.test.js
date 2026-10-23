const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "test_secret";

// Deliberately full of the punctuation a hand-typed private code can contain.
const FREE_CODE = "PRIVATE@#$%^!@#123";

const orders = new Map();
const events = new Map();
let activations = 0;
let razorpayCalls = 0;
let enterpriseAnnualPrice = null;
let orgState;

const offers = {
  [FREE_CODE]: {
    code: FREE_CODE,
    type: "PERCENTAGE",
    value: 100,
    maxDiscountInr: null,
    eligiblePlans: ["ENTERPRISE"],
    eligibleCycles: [],
    firstPaidOrderOnly: false,
    isActive: true,
  },
};

const prisma = {
  billingOffer: {
    findFirst: async ({ where }) => offers[where.code] || null,
  },
  billingPlanPrice: {
    findFirst: async ({ where }) =>
      enterpriseAnnualPrice !== null && where.plan === "ENTERPRISE" && where.billingCycle === "ANNUAL"
        ? { priceInr: enterpriseAnnualPrice }
        : null,
  },
  billingOrder: {
    findFirst: async ({ where }) =>
      [...orders.values()].find((o) =>
        (!where.idempotencyKey || o.idempotencyKey === where.idempotencyKey) &&
        (!where.organizationId || o.organizationId === where.organizationId) &&
        (!where.status || o.status === where.status)
      ) || null,
    create: async ({ data }) => {
      const order = { id: `ord-${orders.size + 1}`, ...data };
      orders.set(order.id, order);
      return order;
    },
    findUnique: async ({ where }) => orders.get(where.id) || null,
    updateMany: async ({ where, data }) => {
      const order = orders.get(where.id);
      if (!order) return { count: 0 };
      if (where.status?.not && order.status === where.status.not) return { count: 0 };
      Object.assign(order, data);
      return { count: 1 };
    },
  },
  billingEvent: {
    create: async ({ data }) => {
      events.set(data.providerEventId, data);
      return data;
    },
  },
  organization: {
    update: async ({ data }) => {
      Object.assign(orgState, data);
      activations += 1;
      return orgState;
    },
  },
  subscription: {
    upsert: async ({ create, update }) => {
      Object.assign(orgState, update || create);
      return orgState;
    },
  },
  async $transaction(fn) {
    return fn(prisma);
  },
};

mockPrisma(prisma);

global.fetch = async () => {
  razorpayCalls += 1;
  return { ok: true, json: async () => ({ id: "order_created" }) };
};

const billingService = require("../src/services/billing.service");

describe("free activation through a 100% offer", () => {
  beforeEach(() => {
    orders.clear();
    events.clear();
    activations = 0;
    razorpayCalls = 0;
    enterpriseAnnualPrice = null;
    orgState = { subscriptionPlan: "FREE_TRIAL", subscriptionStatus: "TRIALING", planLocked: true };
  });

  it("activates Enterprise without creating a Razorpay order", async () => {
    const result = await billingService.createCheckout("org-a", {
      plan: "ENTERPRISE",
      billingCycle: "ANNUAL",
      couponCode: FREE_CODE,
    });

    assert.equal(result.activated, true);
    assert.equal(result.amountInr, 0);
    assert.equal(result.discountAmountInr, result.baseAmountInr);
    assert.equal(result.razorpayOrderId, null);
    assert.equal(razorpayCalls, 0);
    assert.equal(orgState.subscriptionPlan, "ENTERPRISE");
    assert.equal(orgState.subscriptionStatus, "ACTIVE");
    assert.equal(orgState.planLocked, false);
    assert.equal(activations, 1);
  });

  it("records a paid zero-amount order with the offer code for the invoice trail", async () => {
    await billingService.createCheckout("org-a", { plan: "ENTERPRISE", billingCycle: "ANNUAL", couponCode: FREE_CODE });

    const [order] = [...orders.values()];
    assert.equal(order.status, "PAID");
    assert.equal(Number(order.amountInr), 0);
    assert.equal(order.couponCode, FREE_CODE);
    assert.ok(order.paidAt);
    assert.equal(events.size, 1);
  });

  it("matches the code regardless of how it was typed", async () => {
    const result = await billingService.createCheckout("org-a", {
      plan: "ENTERPRISE",
      billingCycle: "ANNUAL",
      couponCode: `  ${FREE_CODE.toLowerCase()}  `,
    });

    assert.equal(result.activated, true);
    assert.equal(result.couponCode, FREE_CODE);
  });

  it("refuses the offer on any other plan and activates nothing", async () => {
    for (const plan of ["STARTER", "PROFESSIONAL"]) {
      await assert.rejects(
        () => billingService.createCheckout("org-a", { plan, billingCycle: "ANNUAL", couponCode: FREE_CODE }),
        /not valid for this plan/,
      );
    }

    assert.equal(activations, 0);
    assert.equal(orders.size, 0);
    assert.equal(orgState.subscriptionPlan, "FREE_TRIAL");
  });

  it("rejects an unknown code instead of treating the order as free", async () => {
    await assert.rejects(
      () => billingService.createCheckout("org-a", { plan: "ENTERPRISE", billingCycle: "ANNUAL", couponCode: "NOT-A-CODE" }),
      /invalid or expired/,
    );
    assert.equal(activations, 0);
  });

  it("activates only once when the same checkout is retried", async () => {
    const payload = { plan: "ENTERPRISE", billingCycle: "ANNUAL", couponCode: FREE_CODE, idempotencyKey: "free-retry-0001" };

    const first = await billingService.createCheckout("org-a", payload);
    const second = await billingService.createCheckout("org-a", payload);

    assert.equal(first.activated, true);
    assert.equal(second.activated, true);
    assert.equal(second.reused, true);
    assert.equal(second.orderId, first.orderId);
    assert.equal(activations, 1);
    assert.equal(orders.size, 1);
  });

  it("never unlocks a plan just because its price is configured as zero", async () => {
    enterpriseAnnualPrice = 0;

    // With no offer there is nothing authorising a free activation, so the order
    // goes down the normal payment path and the plan stays locked.
    await billingService.createCheckout("org-a", { plan: "ENTERPRISE", billingCycle: "ANNUAL" });

    assert.equal(activations, 0);
    assert.equal(orgState.subscriptionPlan, "FREE_TRIAL");
    assert.equal(razorpayCalls, 1);
    assert.equal([...orders.values()][0].status, "CREATED");
  });
});
