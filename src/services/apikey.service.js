const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");

const { DEFAULT_API_KEY_SCOPES } = require("../config/plans");
const { resolveLimits } = require("./entitlement.service");

async function createKey(organizationId, name, scopes) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  const limits = resolveLimits(org || {});
  if (!limits.hasApiAccess) {
    const err = new Error("API access is not included in your current plan.");
    err.statusCode = 403;
    throw err;
  }
  const raw = `wp_live_${crypto.randomBytes(24).toString("hex")}`;
  const scopeList = Array.isArray(scopes) && scopes.length
    ? scopes.map((s) => String(s).trim()).filter(Boolean)
    : DEFAULT_API_KEY_SCOPES;
  const key = await prisma.orgApiKey.create({
    data: {
      organizationId,
      name: String(name || "Default key").trim(),
      keyHash: await bcrypt.hash(raw, 10),
      keyPrefix: raw.slice(0, 12),
      scopes: scopeList.join(","),
    },
  });
  return { ...key, apiKey: raw, scopes: scopeList };
}

async function listKeys(organizationId) {
  return prisma.orgApiKey.findMany({
    where: { organizationId },
    select: { id: true, name: true, keyPrefix: true, isActive: true, lastUsedAt: true, createdAt: true, scopes: true },
    orderBy: { createdAt: "desc" },
  });
}

async function revokeKey(organizationId, id) {
  await prisma.orgApiKey.updateMany({ where: { id, organizationId }, data: { isActive: false } });
  return { success: true };
}

module.exports = { createKey, listKeys, revokeKey };
