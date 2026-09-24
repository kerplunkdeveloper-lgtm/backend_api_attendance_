const crypto = require("crypto");
const prisma = require("../config/database");

const PLAN_INR = {
  STARTER: { MONTHLY: 2499, ANNUAL: 24990 },
  PROFESSIONAL: { MONTHLY: 6999, ANNUAL: 69990 },
  ENTERPRISE: { MONTHLY: 16999, ANNUAL: 169990 },
};

const PLAN_LIMITS = {
  STARTER: { maxEmployees: 25, maxBranches: 2 },
  PROFESSIONAL: { maxEmployees: 100, maxBranches: 10 },
  ENTERPRISE: { maxEmployees: 10000, maxBranches: 100 },
};

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

async function razorpayRequest(path, body) {
  const { key, secret } = requireKeys();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error?.description || "Razorpay request failed");
    err.statusCode = 400;
    throw err;
  }
  return data;
}

async function createCheckout(organizationId, { plan, billingCycle }) {
  const p = String(plan || "").toUpperCase();
  const cycle = String(billingCycle || "MONTHLY").toUpperCase() === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  if (!PLAN_INR[p]) {
    const err = new Error("Choose STARTER, PROFESSIONAL or ENTERPRISE");
    err.statusCode = 400;
    throw err;
  }
  const amountInr = PLAN_INR[p][cycle];
  const rzp = await razorpayRequest("/orders", {
    amount: Math.round(amountInr * 100),
    currency: "INR",
    notes: { organizationId, plan: p, billingCycle: cycle },
  });
  const order = await prisma.billingOrder.create({
    data: {
      organizationId,
      plan: p,
      billingCycle: cycle,
      amountInr,
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
  };
}

function verifySignature(orderId, paymentId, signature) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}

async function applyPaidPlan(organizationId, plan, billingCycle) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.STARTER;
  const months = billingCycle === "ANNUAL" ? 12 : 1;
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + months);
  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      subscriptionPlan: plan,
      subscriptionStatus: "ACTIVE",
      planLocked: false,
      planActivatedAt: new Date(),
      subscriptionExpiresAt: periodEnd,
      maxEmployees: limits.maxEmployees,
    },
  });
  await prisma.subscription.upsert({
    where: { organizationId },
    update: {
      plan,
      status: "ACTIVE",
      billingCycle,
      maxEmployees: limits.maxEmployees,
      maxBranches: limits.maxBranches,
      currentPeriodEnd: periodEnd,
    },
    create: {
      organizationId,
      plan,
      status: "ACTIVE",
      billingCycle,
      maxEmployees: limits.maxEmployees,
      maxBranches: limits.maxBranches,
      currentPeriodEnd: periodEnd,
    },
  });
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
  await prisma.billingOrder.update({
    where: { id: order.id },
    data: { status: "PAID", razorpayPaymentId: razorpay_payment_id, paidAt: new Date() },
  });
  await applyPaidPlan(organizationId, order.plan, order.billingCycle);
  return { success: true, plan: order.plan, billingCycle: order.billingCycle };
}

async function listOrders(organizationId) {
  return prisma.billingOrder.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

async function cancelSubscription(organizationId) {
  const periodEnd = new Date();
  await prisma.organization.update({
    where: { id: organizationId },
    data: { subscriptionStatus: "CANCELED" },
  });
  await prisma.subscription.updateMany({
    where: { organizationId },
    data: { status: "CANCELED" },
  });
  return { success: true, canceledAt: periodEnd, message: "Subscription canceled. Access remains until the current period ends." };
}

async function handleWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    const err = new Error("Razorpay webhook secret is not configured");
    err.statusCode = 503;
    throw err;
  }
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected !== signature) {
    const err = new Error("Invalid webhook signature");
    err.statusCode = 400;
    throw err;
  }
  const event = JSON.parse(rawBody.toString("utf8"));
  const payment = event?.payload?.payment?.entity;
  const orderId = payment?.order_id;
  if (event.event === "payment.captured" && orderId) {
    const order = await prisma.billingOrder.findFirst({ where: { razorpayOrderId: orderId } });
    if (order && order.status !== "PAID") {
      await prisma.billingOrder.update({
        where: { id: order.id },
        data: { status: "PAID", razorpayPaymentId: payment.id, paidAt: new Date() },
      });
      await applyPaidPlan(order.organizationId, order.plan, order.billingCycle);
    }
  }
  return { received: true };
}

module.exports = { createCheckout, verifyPayment, listOrders, cancelSubscription, handleWebhook, PLAN_INR };
