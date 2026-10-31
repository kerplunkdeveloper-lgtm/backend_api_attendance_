const prisma = require("../config/database");
const { uploadBuffer } = require("../config/cloudinary");
const { assertRealImage } = require("../middleware/upload.middleware");
const ssoService = require("./sso.service");
const { isValidTimeZone } = require("../utils/datetime");
const { DEFAULT_OFFER_LETTER_TEMPLATE, normalizeOfferLetterTemplate } = require("../utils/offerLetterTemplate");
const HR_ACCESS_AREAS = ["DASHBOARD", "ATTENDANCE", "EMPLOYEES", "ROLES", "APPROVALS", "ONBOARDING", "PAYROLL", "REPORTS", "ANNOUNCEMENTS", "BRANCHES", "POLICIES", "SHOOTS"];
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
  const { ssoClientSecretCiphertext, ...safe } = organization;
  const storedAccess = organization.hrAccess && typeof organization.hrAccess === "object" ? organization.hrAccess : {};
  const hrAccess = Object.fromEntries(HR_ACCESS_AREAS.map((area) => [area, storedAccess[area] === undefined ? true : storedAccess[area] === true]));
  return { ...safe, hrAccess, roleAccess: normalizeRoleAccess(storedAccess.ROLE_ACCESS), sso: ssoService.getConfiguration(organization) };
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
  let result;
  try {
    result = await uploadBuffer(file.buffer, { folder: `workpulse/${organizationId}/branding`, resource_type: "image" });
  } catch (cause) {
    const error = new Error(cause?.statusCode === 503 ? "Image storage is not configured on the server." : "Logo upload failed. Please try again.");
    error.statusCode = cause?.statusCode === 503 ? 503 : 502;
    throw error;
  }
  const updated = await prisma.organization.update({
    where: { id: organizationId },
    data: { logoUrl: result.secure_url || result.url },
    include: { subscription: true },
  });
  return presentOrganization(updated);
}

async function removeLogo(organizationId) {
  const updated = await prisma.organization.update({ where: { id: organizationId }, data: { logoUrl: null }, include: { subscription: true } });
  return presentOrganization(updated);
}

async function getOfferLetterTemplate(organizationId) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  return normalizeOfferLetterTemplate(org?.hrAccess?.OFFER_LETTER_TEMPLATE || DEFAULT_OFFER_LETTER_TEMPLATE);
}

async function updateOfferLetterTemplate(organizationId, payload) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { hrAccess: true } });
  const hrAccess = org?.hrAccess && typeof org.hrAccess === "object" ? org.hrAccess : {};
  const template = normalizeOfferLetterTemplate(payload || {});
  await prisma.organization.update({ where: { id: organizationId }, data: { hrAccess: { ...hrAccess, OFFER_LETTER_TEMPLATE: template } } });
  return template;
}

module.exports = { getSettings, updateSettings, uploadLogo, removeLogo, getOfferLetterTemplate, updateOfferLetterTemplate };
