const prisma = require("../config/database");
const { uploadBuffer } = require("../config/cloudinary");
const { assertRealImage } = require("../middleware/upload.middleware");

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
  if (payload.logoUrl !== undefined) {
    const url = payload.logoUrl ? String(payload.logoUrl).trim() : null;
    // Only plain https image links; never javascript:, data: or http: URLs.
    if (url && !/^https:\/\/[^\s"'<>]+$/i.test(url)) {
      throw Object.assign(new Error("Logo must be an https link or an uploaded image."), { statusCode: 400 });
    }
    data.logoUrl = url;
  }
  return prisma.organization.update({
    where: { id: organizationId },
    data,
    include: { subscription: true },
  });
}

/** Stores an uploaded company logo and returns the updated organization. */
async function uploadLogo(organizationId, file) {
  if (!file?.buffer) throw Object.assign(new Error("Choose an image to upload."), { statusCode: 400 });
  assertRealImage(file); // real image bytes, not just a claimed type
  let result;
  try {
    result = await uploadBuffer(file.buffer, { folder: `workpulse/${organizationId}/branding`, resource_type: "image" });
  } catch (cause) {
    const error = new Error(cause?.statusCode === 503 ? "Image storage is not configured on the server." : "Logo upload failed. Please try again.");
    error.statusCode = cause?.statusCode === 503 ? 503 : 502;
    throw error;
  }
  return prisma.organization.update({
    where: { id: organizationId },
    data: { logoUrl: result.secure_url || result.url },
    include: { subscription: true },
  });
}

async function removeLogo(organizationId) {
  return prisma.organization.update({ where: { id: organizationId }, data: { logoUrl: null }, include: { subscription: true } });
}

module.exports = { getSettings, updateSettings, uploadLogo, removeLogo };
