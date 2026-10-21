const crypto = require("crypto");
const prisma = require("../config/database");
const { encryptSecret, decryptSecret } = require("../utils/totp");
const { resolveLimits } = require("./entitlement.service");

const EVENT_NAMES = [
  "employee.created",
  "employee.updated",
  "attendance.updated",
  "leave.updated",
  "compoff.updated",
  "expense.updated",
  "payroll.finalized",
  "billing.payment_failed",
  "webhook.test",
];

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

function validateUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw fail("Webhook URL must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.hostname === "localhost")) {
    throw fail("Webhook URL must use HTTPS.");
  }
  return parsed.toString();
}

function normalizeEvents(events) {
  const list = Array.isArray(events) && events.length ? [...new Set(events.map((event) => String(event).trim()))] : ["*"];
  if (list.includes("*")) return ["*"];
  if (list.some((event) => !EVENT_NAMES.includes(event))) throw fail("Webhook contains an unsupported event.");
  return list;
}

async function assertApiAccess(organizationId) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, include: { subscription: true } });
  if (!resolveLimits(organization || {}).hasApiAccess) throw fail("Webhooks are not included in your current plan.", 403);
}

function publicEndpoint(endpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    isActive: endpoint.isActive,
    failureCount: endpoint.failureCount,
    lastDeliveredAt: endpoint.lastDeliveredAt,
    lastFailedAt: endpoint.lastFailedAt,
    createdAt: endpoint.createdAt,
  };
}

async function createEndpoint(organizationId, { url, events } = {}) {
  await assertApiAccess(organizationId);
  const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
  const endpoint = await prisma.webhookEndpoint.create({
    data: { organizationId, url: validateUrl(url), events: normalizeEvents(events), secretCiphertext: encryptSecret(secret) },
  });
  return { endpoint: publicEndpoint(endpoint), secret };
}

async function listEndpoints(organizationId) {
  await assertApiAccess(organizationId);
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  return endpoints.map(publicEndpoint);
}

async function updateEndpoint(organizationId, id, body = {}) {
  await assertApiAccess(organizationId);
  const data = {};
  if (body.url !== undefined) data.url = validateUrl(body.url);
  if (body.events !== undefined) data.events = normalizeEvents(body.events);
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (!Object.keys(data).length) throw fail("Provide a webhook URL, events, or active state.");
  const result = await prisma.webhookEndpoint.updateMany({ where: { id, organizationId }, data });
  if (!result.count) throw fail("Webhook endpoint not found.", 404);
  return publicEndpoint(await prisma.webhookEndpoint.findFirst({ where: { id, organizationId } }));
}

async function deleteEndpoint(organizationId, id) {
  await assertApiAccess(organizationId);
  const result = await prisma.webhookEndpoint.deleteMany({ where: { id, organizationId } });
  if (!result.count) throw fail("Webhook endpoint not found.", 404);
  return { success: true };
}

function signature(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

async function deliver(endpoint, event, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: `evt_${crypto.randomBytes(12).toString("hex")}`, event, createdAt: new Date().toISOString(), data: payload });
  const secret = decryptSecret(endpoint.secretCiphertext);
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "WorkPluse-Webhooks/1.0",
      "x-workpulse-event": event,
      "x-workpulse-signature": `t=${timestamp},v1=${signature(secret, timestamp, body)}`,
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
  await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { failureCount: 0, lastDeliveredAt: new Date() } });
  return { delivered: true, id: endpoint.id };
}

/** Fire-and-forget from domain services; one failing integration never breaks a user request. */
async function dispatch(organizationId, event, payload = {}) {
  if (!EVENT_NAMES.includes(event)) throw fail("Unsupported webhook event.");
  if (!organizationId || !prisma.webhookEndpoint?.findMany) return [];
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, isActive: true, OR: [{ events: { has: "*" } }, { events: { has: event } }] },
  });
  const results = await Promise.all(endpoints.map(async (endpoint) => {
    try {
      return await deliver(endpoint, event, payload);
    } catch (error) {
      await prisma.webhookEndpoint.update({ where: { id: endpoint.id }, data: { failureCount: { increment: 1 }, lastFailedAt: new Date() } }).catch(() => undefined);
      return { delivered: false, id: endpoint.id, error: error.message };
    }
  }));
  return results;
}

async function sendTest(organizationId, id) {
  await assertApiAccess(organizationId);
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId, isActive: true } });
  if (!endpoint) throw fail("Active webhook endpoint not found.", 404);
  return deliver(endpoint, "webhook.test", { message: "WorkPluse webhook connection test" });
}

module.exports = { EVENT_NAMES, createEndpoint, listEndpoints, updateEndpoint, deleteEndpoint, dispatch, sendTest, signature };
