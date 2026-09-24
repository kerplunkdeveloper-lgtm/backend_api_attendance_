const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");

async function createKey(organizationId, name) {
  const raw = `wp_live_${crypto.randomBytes(24).toString("hex")}`;
  const key = await prisma.orgApiKey.create({
    data: {
      organizationId,
      name: String(name || "Default key").trim(),
      keyHash: await bcrypt.hash(raw, 10),
      keyPrefix: raw.slice(0, 12),
    },
  });
  return { ...key, apiKey: raw };
}

async function listKeys(organizationId) {
  return prisma.orgApiKey.findMany({
    where: { organizationId },
    select: { id: true, name: true, keyPrefix: true, isActive: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

async function revokeKey(organizationId, id) {
  await prisma.orgApiKey.updateMany({ where: { id, organizationId }, data: { isActive: false } });
  return { success: true };
}

module.exports = { createKey, listKeys, revokeKey };
