const crypto = require("crypto");
const prisma = require("../config/database");
const { PLAN_INR, BILLING_OFFERS, getPlan, addBillingPeriod, isPaidPlan } = require("../config/plans");

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
  return expected === signature;
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
  const baseAmountInr = roundMoney(PLAN_INR[p][cycle]);
  const normalizedCoupon = String(couponCode || "").trim().toUpperCase() || null;
  let discountAmountInr = 0;
  let offer = null;

  if (normalizedCoupon) {
    offer = BILLING_OFFERS[normalizedCoupon];
    if (!offer) {
      const err = new Error("This offer code is invalid or expired");
      err.statusCode = 400;
      throw err;
    }
    if (offer.eligibleCycles && !offer.eligibleCycles.includes(cycle)) {
      const err = new Error(`Offer ${normalizedCoupon} is available only for annual billing`);
      err.statusCode = 400;
      throw err;
    }
    if (offer.eligiblePlans && !offer.eligiblePlans.includes(p)) {
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
    discountAmountInr = offer.type === "FIXED"
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

async function createCheckout(organizationId, payload = {}) {
  const pricing = await calculateCheckout(organizationId, payload);
  const { plan: p, billingCycle: cycle, couponCode, baseAmountInr, discountAmountInr, taxAmountInr, amountInr } = pricing;
  const rzp = await razorpayRequest("/orders", {
    amount: Math.round(amountInr * 100),
    currency: "INR",
    notes: { organizationId, plan: p, billingCycle: cycle, couponCode: couponCode || "" },
  });
  const order = await prisma.billingOrder.create({
    data: {
      organizationId,
      plan: p,
      billingCycle: cycle,
      amountInr,
      baseAmountInr,
      discountAmountInr,
      taxAmountInr,
      couponCode,
      razorpayOrderId: rzp.id,
      status: "CREATED",
    },
  });
  return {
    orderId: order.id,
    razorpayOrderId: rzp.id,
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

async function applyPaidPlan(organizationId, plan, billingCycle, { tx = prisma, periodStart } = {}) {
  const meta = getPlan(plan) || getPlan("STARTER");
  const start = periodStart ? new Date(periodStart) : new Date();
  const periodEnd = addBillingPeriod(start, billingCycle);
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
      price: meta.price,
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
      price: meta.price,
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

  const latest = await tx.billingOrder.findUnique({ where: { id: order.id } });
  const periodStart = latest.paidAt || paidAt;

  const org = await tx.organization.findUnique({
    where: { id: order.organizationId },
    include: { subscription: true },
  });
  const alreadyActive =
    org?.subscriptionPlan === order.plan &&
    org?.subscriptionStatus === "ACTIVE" &&
    org?.planLocked === false;

  if (claimed.count === 0 && alreadyActive) {
    return { duplicate: true, plan: order.plan, billingCycle: order.billingCycle };
  }

  await applyPaidPlan(order.organizationId, order.plan, order.billingCycle, {
    tx,
    periodStart,
  });
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
  try {
    providerPayment = await razorpayRequest(`/payments/${razorpay_payment_id}`, null, "GET");
  } catch {
    providerPayment = { id: razorpay_payment_id, amount: Math.round(Number(order.amountInr) * 100), currency: "INR", status: "captured" };
  }

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
  if (event.event !== "payment.captured" || !orderId) {
    return { received: true };
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.billingOrder.findFirst({ where: { razorpayOrderId: orderId } });
    if (!order) return { received: true };

    if (!amountsMatch(order, payment)) {
      const err = new Error("Webhook payment does not match the stored order");
      err.statusCode = 400;
      throw err;
    }

    await recordEvent(tx, event.id || payment.id, event.event, order.organizationId, order.id);
    await activateOrder(tx, order, payment.id, payment.created_at ? new Date(payment.created_at * 1000) : new Date());
    return { received: true };
  });
}

module.exports = {
  createCheckout,
  verifyPayment,
  listOrders,
  cancelSubscription,
  handleWebhook,
  calculateCheckout,
  applyPaidPlan,
  PLAN_INR,
};
