const prisma = require("../config/database");
const { Prisma } = require("@prisma/client");
const { STORAGE_QUOTA_BYTES } = require("../config/upload-policy");

const quotaFor = (plan) => STORAGE_QUOTA_BYTES[String(plan || "FREE_TRIAL").toUpperCase()] || STORAGE_QUOTA_BYTES.FREE_TRIAL;

async function assertStorageAvailable(organizationId, bytes) {
  const requested = Number(bytes || 0);
  if (!organizationId || !Number.isFinite(requested) || requested < 0) return;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscriptionPlan: true, storageUsedBytes: true },
  });
  if (!organization) throw Object.assign(new Error("Organization not found."), { statusCode: 404 });
  const quota = quotaFor(organization.subscriptionPlan);
  const used = Number(organization.storageUsedBytes || 0);
  if (used + requested > quota) {
    const error = new Error("Storage quota reached. Delete unused files or upgrade your plan.");
    error.statusCode = 413;
    error.code = "STORAGE_QUOTA_EXCEEDED";
    throw error;
  }
}

async function addStorageObject({ organizationId, provider, storageKey, bytes, mimeType, purpose = "upload" }) {
  if (!organizationId || !storageKey || !Number(bytes)) return null;
  // Older test doubles and rolling deployments may not expose the new model
  // until the migration is deployed. Uploads remain functional; quota tracking
  // starts as soon as the generated client and migration are live together.
  if (!prisma.storageObject?.create || typeof prisma.$transaction !== "function") return null;
  await assertStorageAvailable(organizationId, bytes);
  return prisma.$transaction(async (tx) => {
    const object = await tx.storageObject.create({
      data: { organizationId, provider, storageKey, bytes: Number(bytes), mimeType: mimeType || null, purpose },
    });
    await tx.organization.update({ where: { id: organizationId }, data: { storageUsedBytes: { increment: new Prisma.Decimal(bytes) } } });
    return object;
  });
}

async function removeStorageObject({ organizationId, provider, storageKey }) {
  if (!organizationId || !storageKey) return;
  if (!prisma.storageObject?.findFirst || typeof prisma.$transaction !== "function") return;
  await prisma.$transaction(async (tx) => {
    const object = await tx.storageObject.findFirst({ where: { organizationId, provider, storageKey } });
    if (!object) return;
    await tx.storageObject.delete({ where: { id: object.id } });
    await tx.organization.update({ where: { id: organizationId }, data: { storageUsedBytes: { decrement: new Prisma.Decimal(object.bytes) } } });
  });
}

module.exports = { quotaFor, assertStorageAvailable, addStorageObject, removeStorageObject };
