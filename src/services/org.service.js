const prisma = require("../config/database");
const { organizationLogoUrl } = require("../utils/privateMediaUrls");
const { uploadBuffer } = require("../config/cloudinary");
const { uploadBuffer: uploadS3Buffer, getFileContent, deleteObject: deleteS3Object } = require("../config/s3");
const { assertRealImage } = require("../middleware/upload.middleware");
const ssoService = require("./sso.service");
const { isValidTimeZone } = require("../utils/datetime");
const { DEFAULT_OFFER_LETTER_TEMPLATE, normalizeOfferLetterTemplate } = require("../utils/offerLetterTemplate");
const { DEFAULT_EXIT_DOCUMENT_TEMPLATES, normalizeExitDocumentTemplates } = require("../utils/exitDocumentTemplate");
const HR_ACCESS_AREAS = ["DASHBOARD", "ATTENDANCE", "EMPLOYEES", "ROLES", "APPROVALS", "ONBOARDING", "PAYROLL", "REPORTS", "AUDIT", "ANNOUNCEMENTS", "BRANCHES", "POLICIES", "SHOOTS"];
const DEFAULT_HR_ACCESS = Object.fromEntries(HR_ACCESS_AREAS.map((area) => [area, true]));
const DEFAULT_EMPLOYEE_ACCESS = { DASHBOARD: true, ATTENDANCE: true, EMPLOYEES: false, ROLES: false, APPROVALS: false, ONBOARDING: false, PAYROLL: true, REPORTS: false, ANNOUNCEMENTS: true, BRANCHES: false, POLICIES: false, SHOOTS: true };
const DEFAULT_ROLE_ACCESS = { MANAGER: DEFAULT_HR_ACCESS, HR: DEFAULT_HR_ACCESS, EMPLOYEE: DEFAULT_EMPLOYEE_ACCESS };

const normalizeRoleAccess = (stored) => {
  const source = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const result = {};
  for (const role of ["MANAGER", "HR", "EMPLOYEE"]) {
    const defaults = DEFAULT_ROLE_ACCESS[role];
    const incoming = source[role] && typeof source[role] === "object" ? source[role] : {};
    result[role] = Object.fromEntries(HR_ACCESS_AREAS.map((area) => [area, incoming[area] === undefined ? defaults[area] === true : incoming[area] === true]));
  }
  return result;
};

const presentOrganization = (organization) => {
  if (!organization) return organization;
  const { ssoClientSecretCiphertext, unlockCode, logoStorageKey, ...safe } = organization;
  const storedAccess = organization.hrAccess && typeof organization.hrAccess === "object" ? organization.hrAccess : {};
  const hrAccess = Object.fromEntries(HR_ACCESS_AREAS.map((area) => [area, storedAccess[area] === undefined ? true : storedAccess[area] === true]));
  return { ...safe, logoUrl: organizationLogoUrl(safe), hrAccess, roleAccess: normalizeRoleAccess(storedAccess.ROLE_ACCESS), sso: ssoService.getConfiguration(organization) };
};

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
  return presentOrganization(org);
}

async function updateSettings(organizationId, payload, actor = {}) {
  const data = {};
  if (actor.role === "HR") {
    const unsupported = Object.keys(payload || {}).filter((key) => !["hrAccess", "roleAccess"].includes(key));
    if (unsupported.length) throw Object.assign(new Error("HR can update role permissions only."), { statusCode: 403 });
  }
  const currentAccess = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  const existingAccess = currentAccess?.hrAccess && typeof currentAccess.hrAccess === "object" ? currentAccess.hrAccess : {};
  if (payload.hrAccess !== undefined) {
    if (!payload.hrAccess || typeof payload.hrAccess !== "object" || Array.isArray(payload.hrAccess)) throw Object.assign(new Error("HR access settings must be an object."), { statusCode: 400 });
    const next = {};
    for (const area of HR_ACCESS_AREAS) if (payload.hrAccess[area] !== undefined) next[area] = payload.hrAccess[area] === true;
    data.hrAccess = { ...existingAccess, ...DEFAULT_HR_ACCESS, ...next };
  }
  if (payload.roleAccess !== undefined) {
    if (!payload.roleAccess || typeof payload.roleAccess !== "object" || Array.isArray(payload.roleAccess)) throw Object.assign(new Error("Role access settings must be an object."), { statusCode: 400 });
    const roleAccess = normalizeRoleAccess(payload.roleAccess);
    data.hrAccess = { ...(data.hrAccess || existingAccess), ROLE_ACCESS: roleAccess };
  }
  if (payload.requireAdminTwoFactor !== undefined) {
    const enable = payload.requireAdminTwoFactor === true || payload.requireAdminTwoFactor === "true";
    // Turning the policy on would immediately lock out an admin who has not
    // set up 2FA, including the one flipping the switch.
    if (enable && actor.role === "COMPANY_ADMIN" && !actor.twoFactorEnabled) {
      throw Object.assign(
        new Error("Turn on two-step verification for your own account before requiring it for all admins."),
        { statusCode: 400 },
      );
    }
    data.requireAdminTwoFactor = enable;
  }
  if (payload.name !== undefined) data.name = String(payload.name).trim();
  if (payload.email !== undefined) data.email = payload.email ? String(payload.email).trim().toLowerCase() : null;
  if (payload.phone !== undefined) data.phone = payload.phone ? String(payload.phone).trim() : null;
  if (payload.address !== undefined) data.address = payload.address ? String(payload.address).trim() : null;
  if (payload.taxId !== undefined) data.taxId = payload.taxId ? String(payload.taxId).trim() : null;
  if (payload.timezone !== undefined) {
    const timezone = String(payload.timezone).trim() || "UTC";
    // An unknown zone silently falls back to UTC everywhere, so refuse it here instead.
    if (!isValidTimeZone(timezone)) {
      throw Object.assign(new Error("Timezone is not a valid IANA name, e.g. Asia/Kolkata."), { statusCode: 400 });
    }
    data.timezone = timezone;
  }
  if (payload.currency !== undefined) data.currency = String(payload.currency).trim() || "INR";
  if (payload.logoUrl !== undefined) {
    const url = payload.logoUrl ? String(payload.logoUrl).trim() : null;
    // Only plain https image links; never javascript:, data: or http: URLs.
    if (url && !/^https:\/\/[^\s"'<>]+$/i.test(url)) {
      throw Object.assign(new Error("Logo must be an https link or an uploaded image."), { statusCode: 400 });
    }
    data.logoUrl = url;
    data.logoStorageProvider = "cloudinary";
    data.logoStorageKey = null;
  }
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data,
    include: { subscription: true },
  });
  if (payload.sso !== undefined) {
    await ssoService.updateConfiguration(organizationId, payload.sso || {});
  }
  const current = payload.sso !== undefined
    ? await prisma.organization.findUnique({ where: { id: organizationId }, include: { subscription: true } })
    : updated;
  return presentOrganization(current);
}

/** Stores an uploaded company logo and returns the updated organization. */
async function uploadLogo(organizationId, file) {
  if (!file?.buffer) throw Object.assign(new Error("Choose an image to upload."), { statusCode: 400 });
  assertRealImage(file); // real image bytes, not just a claimed type
  const useS3 = String(process.env.STORAGE_PROVIDER || "").toLowerCase() === "s3";
  const current = await prisma.organization.findUnique({ where: { id: organizationId }, select: { logoStorageKey: true } });
  let result;
  if (useS3) {
    result = await uploadS3Buffer(file.buffer, { organizationId, folder: "branding", contentType: file.mimetype || "image/png" });
    try {
      const updated = await prisma.organization.update({ where: { id: organizationId }, data: { logoUrl: null, logoStorageProvider: "s3", logoStorageKey: result.key }, include: { subscription: true } });
      if (current?.logoStorageKey) await deleteS3Object(current.logoStorageKey, organizationId).catch(() => {});
      return presentOrganization(updated);
    } catch (error) {
      await deleteS3Object(result.key, organizationId).catch(() => {});
      throw error;
    }
  }
  try {
    result = await uploadBuffer(file.buffer, { folder: `workpulse/${organizationId}/branding`, resource_type: "image" });
  } catch (cause) {
    const error = new Error(cause?.statusCode === 503 ? "Image storage is not configured on the server." : "Logo upload failed. Please try again.");
    error.statusCode = cause?.statusCode === 503 ? 503 : 502;
    throw error;
  }
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { logoUrl: result.secure_url || result.url, logoStorageProvider: "cloudinary", logoStorageKey: null },
    include: { subscription: true },
  });
  return presentOrganization(updated);
}

async function removeLogo(organizationId) {
  const current = await prisma.organization.findUnique({ where: { id: organizationId }, select: { logoStorageKey: true } });
  if (current?.logoStorageKey) await deleteS3Object(current.logoStorageKey, organizationId).catch(() => {});
  const updated = await prisma.organization.update({ where: { id: organizationId }, data: { logoUrl: null, logoStorageKey: null }, include: { subscription: true } });
  return presentOrganization(updated);
}

async function getLogoFile(organizationId) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { logoStorageKey: true },
  });
  if (!organization?.logoStorageKey) {
    const error = new Error("Organization logo not found");
    error.statusCode = 404;
    throw error;
  }
  return getFileContent(organization.logoStorageKey, organizationId);
}

async function getOfferLetterTemplate(organizationId) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  return normalizeOfferLetterTemplate(org?.hrAccess?.OFFER_LETTER_TEMPLATE || DEFAULT_OFFER_LETTER_TEMPLATE);
}

async function updateOfferLetterTemplate(organizationId, payload) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  const hrAccess = org?.hrAccess && typeof org.hrAccess === "object" ? org.hrAccess : {};
  const existing = normalizeOfferLetterTemplate(hrAccess.OFFER_LETTER_TEMPLATE || DEFAULT_OFFER_LETTER_TEMPLATE);
  const template = normalizeOfferLetterTemplate({
    ...(payload || {}),
    version: existing.version + 1,
    status: "ACTIVE",
  });
  await prisma.organization.update({ where: { id: organizationId }, data: { hrAccess: { ...hrAccess, OFFER_LETTER_TEMPLATE: template } } });
  return template;
}

async function getExitDocumentTemplates(organizationId) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  return normalizeExitDocumentTemplates(org?.hrAccess?.EXIT_DOCUMENT_TEMPLATES || DEFAULT_EXIT_DOCUMENT_TEMPLATES);
}

async function updateExitDocumentTemplates(organizationId, payload) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  const hrAccess = org?.hrAccess && typeof org.hrAccess === "object" ? org.hrAccess : {};
  const templates = normalizeExitDocumentTemplates(payload || {});
  await prisma.organization.update({ where: { id: organizationId }, data: { hrAccess: { ...hrAccess, EXIT_DOCUMENT_TEMPLATES: templates } } });
  return templates;
}

module.exports = { getSettings, updateSettings, uploadLogo, removeLogo, getLogoFile, getOfferLetterTemplate, updateOfferLetterTemplate, getExitDocumentTemplates, updateExitDocumentTemplates };
