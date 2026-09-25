const crypto = require("crypto");
const prisma = require("../config/database");
const { PLAN_CONFIGS } = require("../config/plans");
const PLAN_INR = Object.fromEntries(Object.entries(PLAN_CONFIGS).filter(([key]) => key !== "FREE_TRIAL").map(([key, value]) => [key, { MONTHLY: value.price, ANNUAL: value.price * 10 }]));
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function validSignature(message, signature, secret) {
  if (!secret) throw fail("Payment credentials are not configured", 503);
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
async function razorpayRequest(path, body) {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) throw fail("Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.", 503);
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw fail("Payment provider request failed. Please retry.", 502);
  return response.json();
}
async function createCheckout(organizationId, { plan, billingCycle = "MONTHLY" }) {
  const p = String(plan || "").toUpperCase();
  const cycle = String(billingCycle).toUpperCase();
  if (!PLAN_INR[p] || !["MONTHLY", "ANNUAL"].includes(cycle)) throw fail("Invalid plan or billing cycle");
  const amountInr = PLAN_INR[p][cycle];
  const order = await razorpayRequest("/orders", { amount: Math.round(amountInr * 100), currency: "INR", notes: { organizationId, plan: p, billingCycle: cycle } });
  const local = await prisma.billingOrder.create({ data: { organizationId, plan: p, billingCycle: cycle, amountInr, razorpayOrderId: order.id, status: "CREATED" } });
  return { orderId: local.id, razorpayOrderId: order.id, amountInr, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, plan: p, billingCycle: cycle };
}
function addMonthsClamped(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}
async function settlePayment(orderId, payment, organizationId) {
  const initial = await prisma.billingOrder.findFirst({ where: { razorpayOrderId: orderId, ...(organizationId ? { organizationId } : {}) } });
  if (!initial) throw fail("Order not found", 404);
  return prisma.$transaction(async (tx) => {
    // One PostgreSQL transaction lock for all entitlement changes in this tenant.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.organizationId}))`;
    const order = await tx.billingOrder.findUnique({ where: { id: initial.id } });
    if (!order || (organizationId && order.organizationId !== organizationId)) throw fail("Order not found", 404);
    if (payment.id === undefined || payment.order_id !== order.razorpayOrderId || payment.status !== "captured" || payment.currency !== "INR" ||
        Number(payment.amount) !== Math.round(Number(order.amountInr) * 100) || Number(payment.amount_refunded || 0) > 0) {
      throw fail("Payment is not captured or does not match this order", 409);
    }
    if (order.status === "PAID") {
      if (order.razorpayPaymentId !== payment.id) throw fail("Order already has a different payment", 409);
      return { success: true, alreadyProcessed: true, plan: order.plan, billingCycle: order.billingCycle };
    }
    if (order.status !== "CREATED") throw fail("Order cannot be activated", 409);
    const plan = PLAN_CONFIGS[order.plan];
    if (!plan || order.plan === "FREE_TRIAL" || !["MONTHLY", "ANNUAL"].includes(order.billingCycle)) throw fail("Invalid stored plan", 409);
    const org = await tx.organization.findUnique({ where: { id: order.organizationId } });
    if (!org || org.deletedAt) throw fail("Organization is unavailable", 409);
    const now = new Date();
    // Same-plan renewals extend unused paid time. Tier changes start a new full period;
    // no automatic proration is claimed by this checkout flow.
    const expiry = org.subscriptionExpiresAt ? new Date(org.subscriptionExpiresAt) : null;
    const base = org.subscriptionPlan === order.plan && expiry > now ? expiry : now;
    const end = addMonthsClamped(base, order.billingCycle === "ANNUAL" ? 12 : 1);
    const changed = await tx.billingOrder.updateMany({ where: { id: order.id, status: "CREATED" }, data: { status: "PAID", razorpayPaymentId: payment.id, paidAt: now } });
    if (changed.count !== 1) throw fail("Order changed; retry verification", 409);
    await tx.organization.update({ where: { id: org.id }, data: { subscriptionPlan: order.plan, subscriptionStatus: "ACTIVE", planLocked: false, planActivatedAt: now, subscriptionExpiresAt: end, maxEmployees: plan.maxEmployees } });
    const entitlement = { plan: order.plan, status: "ACTIVE", billingCycle: order.billingCycle, price: order.amountInr, maxEmployees: plan.maxEmployees, maxBranches: plan.maxBranches, hasGeofence: plan.hasGeofence, hasPayroll: plan.hasPayroll, hasShiftPlanner: plan.hasShiftPlanner, hasApiAccess: plan.hasApiAccess, currentPeriodEnd: end };
    await tx.subscription.upsert({ where: { organizationId: org.id }, update: entitlement, create: { organizationId: org.id, ...entitlement } });
    return { success: true, plan: order.plan, billingCycle: order.billingCycle, currentPeriodEnd: end };
  });
}
async function verifyPayment(organizationId, payload) {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = payload;
  if (typeof orderId !== "string" || typeof paymentId !== "string" || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw fail("Invalid payment fields");
  if (!validSignature(`${orderId}|${paymentId}`, signature, process.env.RAZORPAY_KEY_SECRET)) throw fail("Invalid payment signature");
  const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.id !== paymentId) throw fail("Payment identity mismatch", 409);
  return settlePayment(orderId, payment, organizationId);
}
async function handleWebhook(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody)) throw fail("Raw webhook body required");
  if (!validSignature(rawBody, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) throw fail("Invalid webhook signature");
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch { throw fail("Invalid webhook JSON"); }
  if (event.event !== "payment.captured") return { received: true };
  const payment = event?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id) throw fail("Missing webhook payment fields");
  // Other products may use this provider account; acknowledge unrelated orders.
  const known = await prisma.billingOrder.findFirst({ where: { razorpayOrderId: payment.order_id } });
  if (!known) return { received: true, ignored: true };
  await settlePayment(payment.order_id, payment, known.organizationId);
  return { received: true };
}
async function listOrders(organizationId) {
  return prisma.billingOrder.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
}
async function cancelSubscription(organizationId) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}))`;
    await tx.organization.update({ where: { id: organizationId }, data: { subscriptionStatus: "CANCELED" } });
    await tx.subscription.updateMany({ where: { organizationId }, data: { status: "CANCELED" } });
  });
  return { success: true, message: "Subscription canceled. Access remains until the current paid period ends." };
}
module.exports = { createCheckout, verifyPayment, listOrders, cancelSubscription, handleWebhook, PLAN_INR };
