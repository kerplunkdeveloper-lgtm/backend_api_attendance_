const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { mockPrisma, stubSideEffects, installModule } = require("./helpers/mockPrisma");
stubSideEffects();
process.env.ACCESS_TOKEN_SECRET = "test-access-secret-not-for-deployment";
process.env.RAZORPAY_KEY_ID = "test-key";
process.env.RAZORPAY_KEY_SECRET = "test-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook";
installModule(require.resolve("../src/config/cloudinary"), {
  uploadBuffer: async () => ({ secure_url: "https://example.test/synthetic.pdf" }),
  uploadImage: async () => ({ secure_url: "https://example.test/synthetic.pdf" }),
});
let role, org, targetRole, roleWritten, order, activations, lastFilter, membership, branchCount, failSubscription;
let lock = Promise.resolve();
const prisma = {
  user: { findUnique: async () => ({ id: "actor", role, organizationId: "org-a", isActive: true, organization: org, employee: { id: "emp-a" } }), update: async ({ data }) => { roleWritten = data.role; return data; } },
  employee: { findFirst: async () => ({ id: "emp-a", userId: "actor", organizationId: "org-a", user: { role: targetRole } }), update: async ({ data }) => data },
  organization: { findUnique: async () => org, update: async ({ data }) => { activations++; org = { ...org, ...data }; return org; } },
  subscription: { upsert: async ({ update }) => { if (failSubscription) throw new Error("Synthetic DB failure"); org.subscription = update; return update; }, updateMany: async () => ({ count: 1 }) },
  billingOrder: { findFirst: async () => order, findUnique: async () => order, updateMany: async ({ where, data }) => { if (order.status !== where.status) return { count: 0 }; order = { ...order, ...data }; return { count: 1 }; } },
  onboardingCandidate: { findUnique: async () => ({ id: "candidate-a", status: "INVITED" }), update: async () => ({}) },
  onboardingDocument: { create: async ({ data }) => data },
  overtimeRequest: { findMany: async ({ where }) => { lastFilter = where; return []; }, count: async () => 0 },
  chatMember: { findFirst: async ({ where }) => membership && where.thread.organizationId === "org-a" && where.threadId === "thread-a" ? { id: "membership-a" } : null },
  branch: { count: async () => branchCount, create: async ({ data }) => data },
  $executeRaw: async () => 1,
  async $transaction(fn) {
    let release; const previous = lock; lock = new Promise(r => { release = r; }); await previous;
    const snapshot = structuredClone({ org, order, activations });
    try { return await fn(prisma); } catch (e) { ({ org, order, activations } = snapshot); throw e; } finally { release(); }
  },
};
mockPrisma(prisma);
const express = require("express");
const app = express();app.use(express.json());
app.use("/employees", require("../src/routes/employee.routes"));
app.use("/auth", require("../src/routes/auth.routes"));
app.use("/onboarding", require("../src/routes/onboarding.routes"));
app.use("/overtime", require("../src/routes/overtime.routes"));
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
const jwt = require("../src/utils/jwt");
const billing = require("../src/services/billing.service");
const gateway = require("../src/realtime/chatWs");
let server, base, token;
const originalFetch = global.fetch;
const payment = { id: "pay_audit", order_id: "order_audit", status: "captured", amount: 699900, currency: "INR", amount_refunded: 0 };
before(async () => {
  global.fetch = async (url, options) => String(url).startsWith("https://api.razorpay.com/") ? { ok: true, json: async () => payment } : originalFetch(url, options);
  server = app.listen(0, "127.0.0.1");await once(server, "listening");
  gateway.attachChatWebSocket(server);
  base = `http://127.0.0.1:${server.address().port}`;
  token = jwt.generateAccessToken({ userId: "actor", organizationId: "org-a" });
});
after(async () => { global.fetch = originalFetch; await new Promise(r => server.close(r)); });
beforeEach(() => {
  role = "MANAGER";targetRole = "EMPLOYEE";roleWritten = undefined;activations = 0;membership = true;branchCount = 0;failSubscription = false;
  org = { id: "org-a", subscriptionStatus: "ACTIVE", subscriptionPlan: "PROFESSIONAL", subscriptionExpiresAt: new Date(Date.now() + 86400000), planLocked: false };
  order = { id: "local-order", organizationId: "org-a", status: "CREATED", plan: "PROFESSIONAL", billingCycle: "MONTHLY", amountInr: 6999, razorpayOrderId: "order_audit" };
});
const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const signed = () => ({ razorpay_order_id: payment.order_id, razorpay_payment_id: payment.id, razorpay_signature: crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${payment.order_id}|${payment.id}`).digest("hex") });
test("manager cannot elevate role through employee update", async () => {
  const res = await fetch(`${base}/employees/emp-a`, { method: "PUT", headers: headers(), body: JSON.stringify({ role: "SUPER_ADMIN" }) });
  assert.equal(res.status, 403);assert.equal(roleWritten, undefined);
});
test("manager cannot edit a company administrator", async () => {
  targetRole = "COMPANY_ADMIN";
  const res = await fetch(`${base}/employees/emp-a`, { method: "PUT", headers: headers(), body: JSON.stringify({ firstName: "Changed" }) });
  assert.equal(res.status, 403);
});
test("direct paid plan activation is rejected", async () => {
  role = "COMPANY_ADMIN";
  const res = await fetch(`${base}/auth/upgrade-plan`, { method: "POST", headers: headers(), body: JSON.stringify({ plan: "ENTERPRISE" }) });
  assert.equal(res.status, 403);assert.equal(activations, 0);
});
test("expired subscriptions cannot access business routes", async () => {
  org.subscriptionExpiresAt = new Date("2020-01-01");
  const res = await fetch(`${base}/overtime/pending`, { headers: headers() });assert.equal(res.status, 402);
});
test("pending filter overrides caller status", async () => {
  const res = await fetch(`${base}/overtime/pending?status=APPROVED`, { headers: headers() });
  assert.equal(res.status, 200);assert.equal(lastFilter.status, "PENDING");
});
test("candidate multipart upload is parsed and saved", async () => {
  const form = new FormData();form.append("documentType", "GOVT_ID");form.append("file", new Blob(["%PDF-1.7 synthetic"], { type: "application/pdf" }), "test.pdf");
  const res = await fetch(`${base}/onboarding/portal/token/documents`, { method: "POST", body: form });
  assert.equal(res.status, 201);assert.equal((await res.json()).data.fileName, "test.pdf");
});
test("candidate fake PDF contents are rejected", async () => {
  const form = new FormData();form.append("documentType", "GOVT_ID");form.append("file", new Blob(["not a PDF"], { type: "application/pdf" }), "test.pdf");
  const res = await fetch(`${base}/onboarding/portal/token/documents`, { method: "POST", body: form });assert.equal(res.status, 415);
});
test("concurrent payment replay activates once", async () => {
  const results = await Promise.all([billing.verifyPayment("org-a", signed()), billing.verifyPayment("org-a", signed())]);
  assert.equal(activations, 1);assert.equal(results.filter(r => r.alreadyProcessed).length, 1);
  const expiry = org.subscriptionExpiresAt.toISOString();await billing.verifyPayment("org-a", signed());assert.equal(org.subscriptionExpiresAt.toISOString(), expiry);
});
test("payment activation failure rolls back and can retry", async () => {
  failSubscription = true;await assert.rejects(() => billing.verifyPayment("org-a", signed()), /Synthetic DB failure/);
  assert.equal(order.status, "CREATED");assert.equal(activations, 0);
  failSubscription = false;await billing.verifyPayment("org-a", signed());assert.equal(order.status, "PAID");
});
test("payment amount mismatch cannot activate", async () => {
  order.amountInr = 1;await assert.rejects(() => billing.verifyPayment("org-a", signed()), /does not match/);assert.equal(activations, 0);
});
test("webhook replay after browser verification is harmless", async () => {
  await billing.verifyPayment("org-a", signed());
  const body = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: payment } } }));
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
  await billing.handleWebhook(body, signature);assert.equal(activations, 1);
});
test("branch limit blocks creation", async () => {
  branchCount = 10;await assert.rejects(() => require("../src/services/branch.service").createBranch("org-a", { name: "Extra" }), /Branch limit/);
});
test("chat refuses foreign subscriptions and rechecks membership on delivery", async () => {
  const WebSocket = require("ws");const ws = new WebSocket(base.replace("http", "ws") + `/ws/chat?token=${token}`);
  await once(ws, "open");
  try {
    let reply = once(ws, "message");ws.send(JSON.stringify({ type: "subscribe", threadId: "thread-other-tenant" }));
    assert.equal(JSON.parse((await reply)[0]).type, "error");
    const socket = [...gateway.getSocketsByUser().get("actor")][0];assert.equal(socket.subscribedThreads.size, 0);
    reply = once(ws, "message");ws.send(JSON.stringify({ type: "subscribe", threadId: "thread-a" }));assert.equal(JSON.parse((await reply)[0]).type, "subscribed");
    reply = once(ws, "message");await gateway.broadcastToThread("thread-a", { body: "allowed" });assert.equal(JSON.parse((await reply)[0]).message.body, "allowed");
    membership = false;await gateway.broadcastToThread("thread-a", { body: "blocked" });assert.equal(socket.subscribedThreads.size, 0);
    socket.isAlive = false;socket.emit("pong");assert.equal(socket.isAlive, true);
  } finally { ws.close();await once(ws, "close"); }
});
