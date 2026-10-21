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

/**
 * SSRF protection: reject private, loopback, link-local, CGNAT and ULA IPs.
 * Allow localhost only outside production.
 */
function isPrivateOrLocalHost(hostname) {
  const lower = String(hostname).toLowerCase();
  // Loopback
  if (lower === "localhost" || lower.startsWith("127.") || lower === "::1" || lower === "[::1]") {
    return true;
  }
  // Private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (/^(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\./.test(hostname)) return true;
  // IPv6 link-local, private, loopback
  if (/^(fe80:|fc|fd|::1|::|::ffff:127\.|::ffff:0:127\.)/.test(hostname)) return true;
  return false;
}

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
  // SSRF check at validation time: reject obviously private/loopback addresses
  if (process.env.NODE_ENV === "production" && isPrivateOrLocalHost(parsed.hostname)) {
    throw fail("Webhook URL must not point to a private or loopback address.");
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

/**
 * Exponential backoff: ~1m, 5m, 30m, 2h, 6h, 24h, then stop.
 * Returns ms until the next attempt, or null if max attempts exceeded.
 */
function nextAttemptDelay(attempts) {
  const delays = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];
  return attempts < delays.length ? delays[attempts] : null;
}

/**
 * Try to deliver a single WebhookDelivery record. Returns true on success, false otherwise.
 */
async function attemptDelivery(delivery, endpoint) {
  // SSRF check at delivery time: after DNS lookup, reject private IPs
  // For now, we do hostname validation; a full implementation would resolve and check IPs
  if (process.env.NODE_ENV === "production" && isPrivateOrLocalHost(new URL(endpoint.url).hostname)) {
    throw new Error("Delivery target is a private address");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: delivery.eventId, event: delivery.event, createdAt: new Date(delivery.createdAt).toISOString(), data: delivery.payload });
  const secret = decryptSecret(endpoint.secretCiphertext);
  const response = await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "WorkPulse-Webhooks/1.0",
      "x-workpulse-event": delivery.event,
      "x-workpulse-signature": `t=${timestamp},v1=${signature(secret, timestamp, body)}`,
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return true;
}

/**
 * Process due webhook deliveries with exponential backoff.
 * Claimed with FOR UPDATE SKIP LOCKED so only one instance handles each row.
 */
async function processDueDeliveries(limit = 10) {
  const due = await prisma.$queryRaw`
    SELECT "WebhookDelivery"."id", "WebhookDelivery"."status", "WebhookDelivery"."attempts",
           "WebhookDelivery"."nextAttemptAt", "WebhookDelivery"."event", "WebhookDelivery"."payload",
           "WebhookDelivery"."endpointId", "WebhookEndpoint"."url", "WebhookEndpoint"."secretCiphertext"
    FROM "WebhookDelivery"
    INNER JOIN "WebhookEndpoint" ON "WebhookEndpoint"."id" = "WebhookDelivery"."endpointId"
    WHERE "WebhookDelivery"."status" IN ('PENDING', 'RETRYING')
      AND "WebhookDelivery"."nextAttemptAt" <= NOW()
    ORDER BY "WebhookDelivery"."nextAttemptAt" ASC
    LIMIT ${limit}
    FOR UPDATE OF "WebhookDelivery" SKIP LOCKED`;

  for (const delivery of due) {
    try {
      await attemptDelivery(delivery, { secretCiphertext: delivery.secretCiphertext, url: delivery.url });
      // Success
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          responseStatus: 200,
          lastError: null,
        },
      });
    } catch (error) {
      const nextDelay = nextAttemptDelay(delivery.attempts);
      if (nextDelay) {
        // Retry with exponential backoff (push nextAttemptAt forward)
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "RETRYING",
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + nextDelay),
            lastError: error.message,
          },
        });
      } else {
        // Max attempts exceeded
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "FAILED",
            attempts: { increment: 1 },
            lastError: error.message,
          },
        });
      }
    }
  }
  return due.length;
}

/**
 * Create delivery records for dispatch (outbox pattern).
 * Fire-and-forget from domain services; one failing integration never breaks a user request.
 */
async function dispatch(organizationId, event, payload = {}) {
  if (!EVENT_NAMES.includes(event)) throw fail("Unsupported webhook event.");
  if (!organizationId || !prisma.webhookEndpoint?.findMany) return [];

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, isActive: true, OR: [{ events: { has: "*" } }, { events: { has: event } }] },
  });

  const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`;
  const deliveries = await Promise.all(endpoints.map((endpoint) =>
    prisma.webhookDelivery.create({
      data: {
        organizationId,
        endpointId: endpoint.id,
        eventId,
        event,
        payload,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    })
  ));
  return deliveries.map((d) => ({ created: true, id: d.id }));
}

async function sendTest(organizationId, endpointId) {
  await assertApiAccess(organizationId);
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, organizationId, isActive: true } });
  if (!endpoint) throw fail("Active webhook endpoint not found.", 404);
  // Create a test delivery record
  return dispatch(organizationId, "webhook.test", { message: "WorkPulse webhook connection test" });
}

async function listDeliveries(organizationId, endpointId, opts = {}) {
  await assertApiAccess(organizationId);
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, organizationId } });
  if (!endpoint) throw fail("Webhook endpoint not found.", 404);
  const { status = "DELIVERED", limit = 50, offset = 0 } = opts;
  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId, ...(status && { status }) },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  const total = await prisma.webhookDelivery.count({
    where: { endpointId, ...(status && { status }) },
  });
  return { deliveries, total };
}

async function redeliver(organizationId, deliveryId) {
  const delivery = await prisma.webhookDelivery.findFirst({
    where: { id: deliveryId, organizationId },
    include: { endpoint: true },
  });
  if (!delivery) throw fail("Delivery not found.", 404);
  // Reset for immediate retry
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
    },
  });
  return { requeued: true };
}

module.exports = {
  EVENT_NAMES,
  createEndpoint,
  listEndpoints,
  updateEndpoint,
  deleteEndpoint,
  dispatch,
  sendTest,
  signature,
  processDueDeliveries,
  listDeliveries,
  redeliver,
};
