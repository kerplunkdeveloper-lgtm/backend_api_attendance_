const crypto = require("crypto");
const prisma = require("../config/database");
const { PLAN_INR, BILLING_OFFERS, SUBSCRIPTION_PLANS, getPlan, addBillingPeriod, isPaidPlan } = require("../config/plans");
const emailService = require("./email.service");
const webhookService = require("./webhook.service");

const PLAN_KEYS = ["STARTER", "PROFESSIONAL", "ENTERPRISE"];
const BILLING_CYCLES = ["MONTHLY", "ANNUAL"];

function recurringPlanId(plan, billingCycle) {
  const key = `RAZORPAY_PLAN_${String(plan || "").toUpperCase()}_${String(billingCycle || "MONTHLY").toUpperCase()}`;
  return String(process.env[key] || "").trim() || null;
}

const fallbackOffer = (code) => BILLING_OFFERS[code] || null;

async function getConfiguredPrice(plan, billingCycle) {
  const p = String(plan || "").toUpperCase();
  const cycle = String(billingCycle || "MONTHLY").toUpperCase();
  if (prisma.billingPlanPrice?.findFirst) {
    const configured = await prisma.billingPlanPrice.findFirst({
      where: { plan: p, billingCycle: cycle, isActive: true },
    });
    if (configured) return roundMoney(configured.priceInr);
  }
  return roundMoney(PLAN_INR[p]?.[cycle] || 0);
}

async function getConfiguredLimits(plan, tx = prisma) {
  const p = String(plan || "").toUpperCase();
  const fallback = getPlan(p) || getPlan("STARTER");
  if (tx.billingPlanLimit?.findUnique) {
    const row = await tx.billingPlanLimit.findUnique({ where: { plan: p } });
    if (row) return { ...fallback, ...row };
  }
  return fallback;
}

async function getConfiguredOffer(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (prisma.billingOffer?.findFirst) {
    const now = new Date();
    const configured = await prisma.billingOffer.findFirst({
      where: {
        code: normalized,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
    });
    if (configured) return configured;
    return null;
  }
  return fallbackOffer(normalized);
}

let planCatalogCache = null;
let planCatalogCacheExpiresAt = 0;

async function getPlanCatalog() {
  // This public endpoint must stay fast during rolling deploys. A missing or
  // unreachable optional billing table falls back to the static server catalog.
  const lookup = (work) => Promise.race([
    work,
    new Promise((resolve) => setTimeout(() => resolve([]), 750)),
  ]);

  const [priceResult, limitResult] = await Promise.all([
    prisma.billingPlanPrice?.findMany
      ? lookup(prisma.billingPlanPrice.findMany({ where: { isActive: true } })).catch((error) => {
        console.warn("[Billing] Configured plan prices unavailable; using static catalog:", error.message);
        return [];
      })
      : Promise.resolve([]),
    prisma.billingPlanLimit?.findMany
      ? lookup(prisma.billingPlanLimit.findMany()).catch((error) => {
        console.warn("[Billing] Configured plan limits unavailable; using static catalog:", error.message);
        return [];
      })
      : Promise.resolve([]),
  ]);

  const prices = Array.isArray(priceResult) ? priceResult : [];
  const limits = Array.isArray(limitResult) ? limitResult : [];
  const priceMap = new Map(prices.map((p) => [
    String(p.plan) + ":" + String(p.billingCycle),
    Number(p.priceInr),
  ]));
  const limitMap = new Map(limits.map((item) => [item.plan, item]));

  // Take only the limit fields from the stored row. Spreading the whole row would
  // overwrite the plan's `id` ("ENTERPRISE") with the row's UUID, and checkout
  // would then be sent a plan that does not exist.
  const limitFieldsOf = (row) => row ? {
    maxEmployees: row.maxEmployees,
    maxBranches: row.maxBranches,
    hasGeofence: row.hasGeofence,
    hasPayroll: row.hasPayroll,
    hasShiftPlanner: row.hasShiftPlanner,
    hasApiAccess: row.hasApiAccess,
  } : {};

  const catalog = SUBSCRIPTION_PLANS.map((plan) => ({
    ...plan,
    ...limitFieldsOf(limitMap.get(plan.id)),
    priceMonthly: priceMap.get(plan.id + ":MONTHLY") ?? plan.priceMonthly,
    priceAnnual: priceMap.get(plan.id + ":ANNUAL") ?? plan.priceAnnual,
  }));
  planCatalogCache = catalog;
  planCatalogCacheExpiresAt = Date.now() + 5 * 60 * 1000;
  return catalog;
}
function requireKeys() {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    const err = new Error("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    err.statusCode = 503;
    throw err;
  }
  return { key, secret };
}

async function razorpayRequest(path, body, method = "POST") {
  const { key, secret } = requireKeys();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.description || "Razorpay request failed");
    err.statusCode = 400;
    throw err;
  }
  return data;
}

function verifySignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const received = String(signature || "");
  return received.length === expected.length && crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(received),
  );
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function calculateCheckout(organizationId, { plan, billingCycle, couponCode }) {
  const p = String(plan || "").toUpperCase();
  const cycle = String(billingCycle || "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  if (!isPaidPlan(p) || !PLAN_INR[p]) {
    const err = new Error("Choose STARTER, PROFESSIONAL or ENTERPRISE");
    err.statusCode = 400;
    throw err;
  }
  const baseAmountInr = await getConfiguredPrice(p, cycle);
  const normalizedCoupon = String(couponCode || "").trim().toUpperCase() || null;
  let discountAmountInr = 0;
  let offer = null;

  if (normalizedCoupon) {
    offer = await getConfiguredOffer(normalizedCoupon);
    if (!offer) {
      const err = new Error("This offer code is invalid or expired");
      err.statusCode = 400;
      throw err;
    }
    if (offer.eligibleCycles?.length && !offer.eligibleCycles.includes(cycle)) {
      const err = new Error(`Offer ${normalizedCoupon} is available only for annual billing`);
      err.statusCode = 400;
      throw err;
    }
    if (offer.eligiblePlans?.length && !offer.eligiblePlans.includes(p)) {
      const err = new Error(`Offer ${normalizedCoupon} is not valid for this plan`);
      err.statusCode = 400;
      throw err;
    }
    if (offer.firstPaidOrderOnly) {
      const previousPaidOrder = await prisma.billingOrder.findFirst({
        where: { organizationId, status: "PAID" },
        select: { id: true },
      });
      if (previousPaidOrder) {
        const err = new Error("This offer is available only on your first paid order");
        err.statusCode = 400;
        throw err;
      }
    }
    discountAmountInr = String(offer.type).toUpperCase() === "FIXED"
      ? Number(offer.value)
      : baseAmountInr * (Number(offer.value) / 100);
    if (offer.maxDiscountInr) discountAmountInr = Math.min(discountAmountInr, Number(offer.maxDiscountInr));
  }

  discountAmountInr = roundMoney(Math.min(baseAmountInr, Math.max(0, discountAmountInr)));
  const taxableAmountInr = roundMoney(baseAmountInr - discountAmountInr);
  const taxRate = Math.max(0, Number(process.env.BILLING_TAX_RATE || 0));
  const taxAmountInr = roundMoney(taxableAmountInr * (taxRate / 100));
  const amountInr = roundMoney(taxableAmountInr + taxAmountInr);
  return { plan: p, billingCycle: cycle, couponCode: normalizedCoupon, offer, baseAmountInr, discountAmountInr, taxAmountInr, amountInr, taxRate };
}

const freeCheckoutResponse = (order, taxRate) => ({
  orderId: order.id,
  activated: true,
  razorpayOrderId: null,
  razorpaySubscriptionId: null,
  amountInr: 0,
  currency: "INR",
  plan: order.plan,
  billingCycle: order.billingCycle,
  baseAmountInr: Number(order.baseAmountInr || 0),
  discountAmountInr: Number(order.discountAmountInr || 0),
  taxAmountInr: 0,
  couponCode: order.couponCode,
  taxRate,
});

/**
 * A 100%-off offer leaves nothing to charge, and Razorpay refuses orders under
 * ₹1, so there is no payment to wait for. The order is recorded as PAID and the
 * plan is activated through the same path a verified payment uses, in one
 * transaction so a failure never leaves an activated plan without its order.
 */
async function activateFreeOrder(organizationId, pricing, idempotencyKey) {
  const { plan, billingCycle, couponCode, baseAmountInr, discountAmountInr, taxRate } = pricing;
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.billingOrder.create({
        data: {
          organizationId,
          plan,
          billingCycle,
          amountInr: 0,
          baseAmountInr,
          discountAmountInr,
          taxAmountInr: 0,
          couponCode,
          idempotencyKey,
          status: "CREATED",
        },
      });
      await recordEvent(tx, `offer:${created.id}`, "offer.free_activation", organizationId, created.id);
      await activateOrder(tx, created, null);
      return created;
    });
  } catch (err) {
    // Two clicks can race past the idempotency lookup; return the order that won.
    if (err?.code !== "P2002" || !idempotencyKey) throw err;
    order = await prisma.billingOrder.findFirst({ where: { organizationId, idempotencyKey } });
    if (!order) throw err;
  }
  return freeCheckoutResponse(order, taxRate);
}

async function createCheckout(organizationId, payload = {}) {
  const pricing = await calculateCheckout(organizationId, payload);
  const { plan: p, billingCycle: cycle, couponCode, baseAmountInr, discountAmountInr, taxAmountInr, amountInr } = pricing;
  const idempotencyKey = String(payload.idempotencyKey || "").trim() || null;

  if (idempotencyKey) {
    const existing = await prisma.billingOrder.findFirst({
      where: { organizationId, idempotencyKey },
    });
    if (existing) {
      if (existing.status === "PAID" && Number(existing.amountInr) === 0) {
        return { ...freeCheckoutResponse(existing, pricing.taxRate), reused: true };
      }
      return {
        orderId: existing.id,
        razorpayOrderId: existing.razorpayOrderId,
        razorpaySubscriptionId: existing.razorpaySubscriptionId,
        amountInr: Number(existing.amountInr),
        currency: "INR",
        keyId: process.env.RAZORPAY_KEY_ID,
        plan: existing.plan,
        billingCycle: existing.billingCycle,
        baseAmountInr: Number(existing.baseAmountInr || 0),
        discountAmountInr: Number(existing.discountAmountInr || 0),
        taxAmountInr: Number(existing.taxAmountInr || 0),
        couponCode: existing.couponCode,
        taxRate: pricing.taxRate,
        reused: true,
      };
    }
  }

  // Only a configured offer may take an order to zero. A plan that merely has a
  // ₹0 price (a misconfigured price row, say) must never unlock itself.
  if (couponCode && pricing.offer && baseAmountInr > 0 && amountInr === 0) {
    return activateFreeOrder(organizationId, pricing, idempotencyKey);
  }

  const configuredPlanId = recurringPlanId(p, cycle);
  if (configuredPlanId && couponCode) {
    const err = new Error("Discount codes are not supported on recurring Razorpay subscriptions. Use one-time checkout or remove the coupon.");
    err.statusCode = 400;
    throw err;
  }
  const rzp = configuredPlanId
    ? await razorpayRequest("/subscriptions", {
      plan_id: configuredPlanId,
      total_count: cycle === "ANNUAL" ? 10 : 120,
      customer_notify: 1,
      notes: { organizationId, plan: p, billingCycle: cycle, couponCode: couponCode || "" },
    })
    : await razorpayRequest("/orders", {
      amount: Math.round(amountInr * 100),
      currency: "INR",
      notes: { organizationId, plan: p, billingCycle: cycle, couponCode: couponCode || "" },
    });
  let order;
  try {
    order = await prisma.billingOrder.create({
      data: {
        organizationId,
        plan: p,
        billingCycle: cycle,
        amountInr,
        baseAmountInr,
        discountAmountInr,
        taxAmountInr,
        couponCode,
        idempotencyKey,
        razorpayOrderId: configuredPlanId ? null : rzp.id,
        razorpaySubscriptionId: configuredPlanId ? rzp.id : null,
        status: "CREATED",
      },
    });
  } catch (err) {
    // Two browser clicks can race after the initial lookup. Return the
    // already persisted order instead of creating a second activation path.
    if (err?.code !== "P2002" || !idempotencyKey) throw err;
    const existing = await prisma.billingOrder.findFirst({
      where: { organizationId, idempotencyKey },
    });
    if (!existing) throw err;
    order = existing;
  }
  return {
    orderId: order.id,
    razorpayOrderId: configuredPlanId ? null : rzp.id,
    razorpaySubscriptionId: configuredPlanId ? rzp.id : null,
    amountInr,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
    plan: p,
    billingCycle: cycle,
    baseAmountInr,
    discountAmountInr,
    taxAmountInr,
    couponCode,
    taxRate: pricing.taxRate,
  };
}

async function applyPaidPlan(organizationId, plan, billingCycle, { tx = prisma, periodStart, extendFromCurrent = false } = {}) {
  const meta = await getConfiguredLimits(plan, tx);
  const configuredPrice = tx.billingPlanPrice?.findFirst
    ? await tx.billingPlanPrice.findFirst({
      where: { plan: meta.plan, billingCycle, isActive: true },
    })
    : null;
  const start = periodStart ? new Date(periodStart) : new Date();

  // Renewing the same plan before it runs out adds a new period after the current one, so the days
  // already paid for are not lost. Switching plans starts a fresh period from now.
  let periodBase = start;
  if (extendFromCurrent && tx.organization?.findUnique) {
    const current = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionPlan: true, subscriptionStatus: true, subscriptionExpiresAt: true },
    });
    const expiry = current?.subscriptionExpiresAt ? new Date(current.subscriptionExpiresAt) : null;
    if (
      current &&
      current.subscriptionPlan === meta.plan &&
      ["ACTIVE", "CANCELED"].includes(current.subscriptionStatus) &&
      expiry &&
      expiry > start
    ) {
      periodBase = expiry;
    }
  }
  const periodEnd = addBillingPeriod(periodBase, billingCycle);
  await tx.organization.update({
    where: { id: organizationId },
    data: {
      subscriptionPlan: meta.plan,
      subscriptionStatus: "ACTIVE",
      planLocked: false,
      planActivatedAt: start,
      subscriptionExpiresAt: periodEnd,
      maxEmployees: meta.maxEmployees,
    },
  });
  await tx.subscription.upsert({
    where: { organizationId },
    update: {
      plan: meta.plan,
      status: "ACTIVE",
      billingCycle,
      price: configuredPrice ? Number(configuredPrice.priceInr) : meta.price,
      maxEmployees: meta.maxEmployees,
      maxBranches: meta.maxBranches,
      hasGeofence: meta.hasGeofence,
      hasPayroll: meta.hasPayroll,
      hasShiftPlanner: meta.hasShiftPlanner,
      hasApiAccess: meta.hasApiAccess,
      currentPeriodEnd: periodEnd,
    },
    create: {
      organizationId,
      plan: meta.plan,
      status: "ACTIVE",
      billingCycle,
      price: configuredPrice ? Number(configuredPrice.priceInr) : meta.price,
      maxEmployees: meta.maxEmployees,
      maxBranches: meta.maxBranches,
      hasGeofence: meta.hasGeofence,
      hasPayroll: meta.hasPayroll,
      hasShiftPlanner: meta.hasShiftPlanner,
      hasApiAccess: meta.hasApiAccess,
      currentPeriodEnd: periodEnd,
    },
  });
  return periodEnd;
}

function amountsMatch(order, payment) {
  if (!payment) return true;
  const paidPaise = Number(payment.amount);
  const expectedPaise = Math.round(Number(order.amountInr) * 100);
  if (Number.isFinite(paidPaise) && paidPaise !== expectedPaise) return false;
  if (payment.currency && String(payment.currency).toUpperCase() !== "INR") return false;
  if (payment.status && !["captured", "authorized"].includes(String(payment.status))) return false;
  return true;
}

async function recordEvent(tx, providerEventId, eventType, organizationId, orderId) {
  if (!providerEventId || !tx.billingEvent?.create) return;
  try {
    await tx.billingEvent.create({
      data: {
        providerEventId: String(providerEventId),
        eventType: eventType || "unknown",
        organizationId: organizationId || null,
        orderId: orderId || null,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") return;
    throw err;
  }
}

async function activateOrder(tx, order, paymentId, paidAt = new Date()) {
  if (typeof tx.$queryRaw === "function") {
    await tx.$queryRaw`SELECT id FROM "BillingOrder" WHERE id = ${order.id} FOR UPDATE`;
  }

  const claimed = await tx.billingOrder.updateMany({
    where: { id: order.id, status: { not: "PAID" } },
    data: {
      status: "PAID",
      razorpayPaymentId: paymentId || order.razorpayPaymentId,
      paidAt: order.paidAt || paidAt,
    },
  });

  // A paid order is immutable. Replaying an old successful payment must
  // never re-activate an older plan after a later upgrade or downgrade.
  if (claimed.count === 0) {
    return { duplicate: true, plan: order.plan, billingCycle: order.billingCycle };
  }

  const latest = await tx.billingOrder.findUnique({ where: { id: order.id } });
  const periodStart = latest.paidAt || paidAt;

  await applyPaidPlan(order.organizationId, order.plan, order.billingCycle, {
    tx,
    periodStart,
    // Only real payments stack time. A 100%-off code must not extend the plan each time it is applied.
    extendFromCurrent: Number(order.amountInr) > 0,
  });
  if (order.razorpaySubscriptionId && tx.subscription?.update) {
    await tx.subscription.update({
      where: { organizationId: order.organizationId },
      data: { razorpaySubscriptionId: order.razorpaySubscriptionId },
    });
  }
  return { duplicate: false, plan: order.plan, billingCycle: order.billingCycle };
}

async function verifyPayment(organizationId, payload) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    const err = new Error("Missing Razorpay payment fields");
    err.statusCode = 400;
    throw err;
  }
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    const err = new Error("Invalid payment signature");
    err.statusCode = 400;
    throw err;
  }

  const order = await prisma.billingOrder.findFirst({
    where: { razorpayOrderId: razorpay_order_id, organizationId },
  });
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  let providerPayment = null;
  providerPayment = await razorpayRequest(`/payments/${razorpay_payment_id}`, null, "GET");

  if (!amountsMatch(order, providerPayment)) {
    const err = new Error("Paid amount or currency does not match the stored order");
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await recordEvent(tx, razorpay_payment_id, "payment.verify", organizationId, order.id);
    return activateOrder(tx, order, razorpay_payment_id);
  });
}

function verifySubscriptionSignature(paymentId, subscriptionId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto.createHmac("sha256", secret).update(`${paymentId}|${subscriptionId}`).digest("hex");
  const received = String(signature || "");
  return received.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

async function verifySubscription(organizationId, payload) {
  const { razorpay_subscription_id: subscriptionId, razorpay_payment_id: paymentId, razorpay_signature: signature } = payload;
  if (!subscriptionId || !paymentId || !verifySubscriptionSignature(paymentId, subscriptionId, signature)) {
    const err = new Error("Invalid recurring payment signature"); err.statusCode = 400; throw err;
  }
  const order = await prisma.billingOrder.findFirst({ where: { razorpaySubscriptionId: subscriptionId, organizationId } });
  if (!order) { const err = new Error("Recurring subscription not found"); err.statusCode = 404; throw err; }
  const providerPayment = await razorpayRequest(`/payments/${paymentId}`, null, "GET");
  if (!amountsMatch(order, providerPayment) && Number(order.amountInr) > 0) {
    const err = new Error("Paid amount or currency does not match the stored subscription"); err.statusCode = 400; throw err;
  }
  return prisma.$transaction(async (tx) => {
    await recordEvent(tx, paymentId, "subscription.verify", organizationId, order.id);
    return activateOrder(tx, order, paymentId);
  });
}

async function listOrders(organizationId) {
  return prisma.billingOrder.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

async function cancelSubscription(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  const periodEnd = org?.subscriptionExpiresAt || org?.subscription?.currentPeriodEnd || new Date();
  if (org?.subscription?.razorpaySubscriptionId) {
    await razorpayRequest(`/subscriptions/${org.subscription.razorpaySubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
  }
  await prisma.organization.update({
    where: { id: organizationId },
    data: { subscriptionStatus: "CANCELED" },
  });
  await prisma.subscription.updateMany({
    where: { organizationId },
    data: { status: "CANCELED" },
  });
  return {
    success: true,
    canceledAt: new Date(),
    currentPeriodEnd: periodEnd,
    message: "Subscription canceled. Access remains until the current period ends.",
  };
}

async function handleWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error("Razorpay webhook secret is not configured");
    err.statusCode = 503;
    throw err;
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = String(signature || "");
  const validSignature =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!validSignature) {
    const err = new Error("Invalid webhook signature");
    err.statusCode = 400;
    throw err;
  }
  const event = JSON.parse(rawBody.toString("utf8"));
  const payment = event?.payload?.payment?.entity;
  const orderId = payment?.order_id;
  const providerSubscriptionId = event?.payload?.subscription?.entity?.id || payment?.subscription_id;
  if (!orderId && !providerSubscriptionId) {
    return { received: true };
  }

  const result = await prisma.$transaction(async (tx) => {
    if (providerSubscriptionId && String(event.event || "").startsWith("subscription.")) {
      const subscription = await tx.subscription.findUnique({ where: { razorpaySubscriptionId: providerSubscriptionId }, include: { organization: true } });
      if (!subscription) return { received: true };
      const eventId = event.id || payment?.id || providerSubscriptionId;
      const prior = tx.billingEvent?.findUnique ? await tx.billingEvent.findUnique({ where: { providerEventId: String(eventId) }, select: { id: true } }) : null;
      if (prior) return { received: true, duplicate: true };
      await recordEvent(tx, eventId, event.event, subscription.organizationId, null);
      if (["subscription.halted", "subscription.cancelled", "subscription.completed"].includes(event.event)) {
        await tx.subscription.update({ where: { organizationId: subscription.organizationId }, data: { status: event.event === "subscription.cancelled" ? "CANCELED" : "PAST_DUE" } });
        await tx.organization.update({ where: { id: subscription.organizationId }, data: { subscriptionStatus: event.event === "subscription.cancelled" ? "CANCELED" : "PAST_DUE" } });
        return { received: true };
      }
      if (event.event !== "subscription.charged" && event.event !== "subscription.activated") return { received: true };
      if (event.event === "subscription.activated" && !payment) return { received: true };
      const paidAt = payment?.created_at ? new Date(payment.created_at * 1000) : new Date();
      const order = await tx.billingOrder.create({ data: {
        organizationId: subscription.organizationId,
        plan: subscription.plan,
        billingCycle: subscription.billingCycle,
        amountInr: Number(payment?.amount || subscription.price * 100) / 100,
        baseAmountInr: Number(payment?.amount || subscription.price * 100) / 100,
        discountAmountInr: 0,
        taxAmountInr: 0,
        razorpaySubscriptionId: providerSubscriptionId,
        razorpayPaymentId: payment?.id || null,
        status: "PAID",
        paidAt,
      } });
      const currentEnd = subscription.currentPeriodEnd && subscription.currentPeriodEnd > paidAt ? subscription.currentPeriodEnd : paidAt;
      await applyPaidPlan(subscription.organizationId, subscription.plan, subscription.billingCycle, { tx, periodStart: currentEnd });
      return { received: true, renewed: true, orderId: order.id };
    }
    const order = await tx.billingOrder.findFirst({ where: { razorpayOrderId: orderId } });
    if (!order) return { received: true };

    if (event.event === "payment.failed") {
      await recordEvent(tx, event.id || payment.id, event.event, order.organizationId, order.id);
      await tx.billingOrder.updateMany({
        where: { id: order.id, status: { not: "PAID" } },
        data: { status: "FAILED" },
      });
      // Keep the workspace usable during its existing paid period. Entitlement
      // logic can apply the configured grace/expiry policy on a later check.
      await tx.subscription.updateMany({
        where: { organizationId: order.organizationId, status: "ACTIVE" },
        data: { status: "PAST_DUE" },
      });
      await tx.organization.updateMany({
        where: { id: order.organizationId, subscriptionStatus: "ACTIVE" },
        data: { subscriptionStatus: "PAST_DUE" },
      });
      const organization = tx.organization.findUnique
        ? await tx.organization.findUnique({ where: { id: order.organizationId }, select: { name: true, email: true, logoUrl: true } })
        : null;
      return {
        received: true,
        paymentFailed: true,
        webhookPayload: { organizationId: order.organizationId, orderId: order.id, plan: order.plan, billingCycle: order.billingCycle, amountInr: Number(order.amountInr) },
        notification: organization?.email
          ? { to: organization.email, companyName: organization.name, companyLogoUrl: organization.logoUrl, plan: order.plan, billingCycle: order.billingCycle, amountInr: Number(order.amountInr) }
          : null,
      };
    }

    if (event.event !== "payment.captured") return { received: true };

    if (!amountsMatch(order, payment)) {
      const err = new Error("Webhook payment does not match the stored order");
      err.statusCode = 400;
      throw err;
    }

    await recordEvent(tx, event.id || payment.id, event.event, order.organizationId, order.id);
    await activateOrder(tx, order, payment.id, payment.created_at ? new Date(payment.created_at * 1000) : new Date());
    return { received: true };
  });

  if (result.notification) {
    emailService.sendBillingPaymentFailedEmail(result.notification.to, result.notification)
      .catch((error) => console.warn("[Billing] Failed payment email dispatch failed:", error.message));
    delete result.notification;
  }
  if (result.paymentFailed && result.webhookPayload) {
    webhookService.dispatch(result.webhookPayload.organizationId, "billing.payment_failed", result.webhookPayload).catch(() => undefined);
    delete result.webhookPayload;
  }
  return result;
}

async function getInvoiceData(organizationId, orderId) {
  const order = await prisma.billingOrder.findFirst({
    where: { id: orderId, organizationId, status: "PAID" },
    include: {
      organization: {
        select: { name: true, email: true, phone: true, address: true, taxId: true, logoUrl: true, currency: true },
      },
    },
  });
  if (!order) {
    const error = new Error("Paid invoice not found");
    error.statusCode = 404;
    throw error;
  }
  return {
    id: order.id,
    invoiceNumber: `INV-${String(order.id).slice(0, 8).toUpperCase()}`,
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    issuedAt: order.paidAt || order.createdAt,
    plan: order.plan,
    billingCycle: order.billingCycle,
    amountInr: Number(order.amountInr),
    baseAmountInr: Number(order.baseAmountInr || 0),
    discountAmountInr: Number(order.discountAmountInr || 0),
    taxAmountInr: Number(order.taxAmountInr || 0),
    couponCode: order.couponCode,
    organization: order.organization,
  };
}

module.exports = {
  createCheckout,
  verifyPayment,
  verifySubscription,
  listOrders,
  getInvoiceData,
  cancelSubscription,
  handleWebhook,
  calculateCheckout,
  getPlanCatalog,
  getConfiguredPrice,
  applyPaidPlan,
  getConfiguredLimits,
  PLAN_KEYS,
  BILLING_CYCLES,
  PLAN_INR,
};
