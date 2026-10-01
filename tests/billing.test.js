const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { mockPrisma, stubSideEffects } = require("./helpers/mockPrisma");

stubSideEffects();

process.env.RAZORPAY_KEY_ID = "rzp_test_key";
process.env.RAZORPAY_KEY_SECRET = "test_secret";

const orders = new Map();
const events = new Map();
let activations = 0;
let orgState = {
  subscriptionPlan: "FREE_TRIAL",
  subscriptionStatus: "TRIALING",
  planLocked: true,
};

const prisma = {
  billingOrder: {
    findFirst: async ({ where }) =>
      [...orders.values()].find((o) => o.razorpayOrderId === where.razorpayOrderId && (!where.organizationId || o.organizationId === where.organizationId)) || null,
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
      if (events.has(data.providerEventId)) {
        const err = new Error("duplicate");
        err.code = "P2002";
        throw err;
      }
      events.set(data.providerEventId, data);
      return data;
    },
    findUnique: async ({ where }) => events.get(where.providerEventId) || null,
  },
  organization: {
    findUnique: async () => ({ ...orgState, subscription: orgState }),
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
    updateMany: async () => ({ count: 1 }),
  },
  async $transaction(fn) {
    return fn(prisma);
  },
};

mockPrisma(prisma);

const originalFetch = global.fetch;
global.fetch = async () => ({
  ok: true,
  json: async () => ({ amount: 249900, currency: "INR", status: "captured" }),
});

const billingService = require("../src/services/billing.service");
const authService = require("../src/services/auth.service");

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", "test_secret").update(`${orderId}|${paymentId}`).digest("hex");

describe("billing activation", () => {
  it("calculates server-owned offer pricing", async () => {
    const pricing = await billingService.calculateCheckout("org-a", {
      plan: "STARTER",
      billingCycle: "MONTHLY",
      couponCode: "WELCOME20",
    });

    assert.equal(pricing.baseAmountInr, 2499);
    assert.equal(pricing.discountAmountInr, 499.8);
    assert.equal(pricing.amountInr, 1999.2);
    assert.equal(pricing.couponCode, "WELCOME20");
  });

  it("activates a paid order only once when verification is replayed", async () => {
    orders.set("ord-1", {
      id: "ord-1",
      organizationId: "org-a",
      plan: "STARTER",
      billingCycle: "MONTHLY",
      amountInr: 2499,
      razorpayOrderId: "order_1",
      status: "CREATED",
      paidAt: null,
    });

    const payload = {
      razorpay_order_id: "order_1",
      razorpay_payment_id: "pay_1",
      razorpay_signature: sign("order_1", "pay_1"),
    };

    const first = await billingService.verifyPayment("org-a", payload);
    const second = await billingService.verifyPayment("org-a", payload);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(activations, 1);
    assert.equal(orgState.subscriptionPlan, "STARTER");
    assert.equal(orgState.subscriptionStatus, "ACTIVE");
  });

  it("rejects company-admin unpaid upgrades", async () => {
    await assert.rejects(
      () =>
        authService.upgradePlan("org-a", "PROFESSIONAL", "MONTHLY", {
          actorRole: "COMPANY_ADMIN",
          actorUserId: "admin-1",
        }),
      /verified payment/,
    );
  });
});

process.on("exit", () => {
  global.fetch = originalFetch;
});
