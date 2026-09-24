const prisma = require("../config/database");

async function getSettings(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: { subscription: true },
  });
  if (!org) {
    const err = new Error("Organization not found");
    err.statusCode = 404;
    throw err;
  }
  return org;
}

async function updateSettings(organizationId, payload) {
  const data = {};
  if (payload.name !== undefined) data.name = String(payload.name).trim();
  if (payload.email !== undefined) data.email = payload.email ? String(payload.email).trim().toLowerCase() : null;
  if (payload.phone !== undefined) data.phone = payload.phone ? String(payload.phone).trim() : null;
  if (payload.address !== undefined) data.address = payload.address ? String(payload.address).trim() : null;
  if (payload.taxId !== undefined) data.taxId = payload.taxId ? String(payload.taxId).trim() : null;
  if (payload.timezone !== undefined) data.timezone = String(payload.timezone).trim() || "UTC";
  if (payload.currency !== undefined) data.currency = String(payload.currency).trim() || "INR";
  if (payload.logoUrl !== undefined) data.logoUrl = payload.logoUrl ? String(payload.logoUrl).trim() : null;
  return prisma.organization.update({
    where: { id: organizationId },
    data,
    include: { subscription: true },
  });
}

module.exports = { getSettings, updateSettings };
