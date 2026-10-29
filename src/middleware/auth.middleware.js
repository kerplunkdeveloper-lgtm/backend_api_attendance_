const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");
const { organizationWithSubscription } = require("../utils/prismaSelects");
const { evaluateEntitlement, isRecoveryPath, resolveLimits, assertFeature } = require("../services/entitlement.service");
const { DEFAULT_API_KEY_SCOPES } = require("../config/plans");
const { setTenant } = require("../utils/tenantContext");
const { denyIfTenantTwoFactorMissing } = require("./twoFactor.middleware");
const { tenantRateLimiter } = require("./rateLimiter.middleware");

// The platform owner's console reads across every workspace, so only tenant
// roles are confined to their own organization by the Prisma tenant guard.
const scopeRequestToTenant = (role, organizationId) => {
  if (role !== "SUPER_ADMIN") setTenant(organizationId);
};

const parseScopes = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [...DEFAULT_API_KEY_SCOPES];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

// Keyed by the router a request is mounted on (its first path segment after
// /api), not by substrings of the full URL, so /reports/attendance-summary needs
// read:reports rather than read:attendance. Unlisted routers need admin scope.
const SCOPE_RESOURCE_BY_ROUTER = {
  employees: "employees",
  attendance: "attendance",
  corrections: "attendance",
  reports: "reports",
  payroll: "payroll",
  leaves: "leave",
  biometric: "biometric",
};

const routerSegment = (req) => {
  const mount = String(req.baseUrl || req.originalUrl || req.path || "")
    .split("?")[0]
    .toLowerCase()
    .replace(/^\/(api\/)?(v1\/)?/, "");
  return mount.split("/")[0];
};

const requiredScopeFor = (req) => {
  const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const resource = SCOPE_RESOURCE_BY_ROUTER[routerSegment(req)] || "admin";
  return `${write ? "write" : "read"}:${resource}`;
};

const extractApiKey = (req) => {
  const headerKey = req.headers["x-api-key"];
  if (headerKey) return String(headerKey).trim();
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer wp_live_")) return authHeader.slice(7).trim();
  if (authHeader.startsWith("ApiKey ")) return authHeader.slice(7).trim();
  return null;
};

const resolveOrgApiKey = async (raw) => {
  if (!raw || !raw.startsWith("wp_live_")) return null;
  const prefix = raw.slice(0, 12);
  const candidates = await prisma.orgApiKey.findMany({
    where: { keyPrefix: prefix, isActive: true },
    include: { organization: organizationWithSubscription },
  });
  for (const key of candidates) {
    if (await bcrypt.compare(raw, key.keyHash)) return key;
  }
  return null;
};

const sessionPathRe = /^\/(api\/)?auth\/(me|login|logout|refresh|refresh-token)(\/|$)/;

const denyIfLocked = (req, res, org) => {
  const entitlement = evaluateEntitlement(org);
  if (entitlement.code === "ACCOUNT_SUSPENDED") {
    const path = String(req?.originalUrl || req?.path || "").split("?")[0];
    if (sessionPathRe.test(path)) return null;
    return res.status(403).json({ success: false, code: entitlement.code, message: entitlement.message });
  }
  if (isRecoveryPath(req)) return null;
  if (!entitlement.allowApp) {
    return res.status(402).json({
      success: false,
      code: entitlement.code,
      message: entitlement.message,
    });
  }
  return null;
};

const authenticateWithApiKey = async (req, res, rawKey) => {
  const key = await resolveOrgApiKey(rawKey);
  if (!key) {
    return res.status(401).json({
      success: false,
      message: "Invalid API key",
    });
  }

  if (key.organization?.deletedAt) {
    return res.status(403).json({
      success: false,
      message: "This organization is no longer active.",
    });
  }

  const limits = resolveLimits(key.organization);
  if (!limits.hasApiAccess) {
    return res.status(403).json({
      success: false,
      message: "API access is not included in your current plan.",
    });
  }

  const blocked = denyIfLocked(req, res, key.organization);
  if (blocked) return blocked;

  // Checked here rather than in authorizeRoles so routes that only call
  // authenticate cannot be reached by a key without the matching scope.
  const scopes = parseScopes(key.scopes);
  const needed = requiredScopeFor(req);
  if (!scopes.includes(needed)) {
    return res.status(403).json({
      success: false,
      message: `API key is missing scope '${needed}'`,
      requiredScope: needed,
    });
  }

  req.user = {
    id: `apikey:${key.id}`,
    email: null,
    role: "API_KEY",
    organizationId: key.organizationId,
    organization: key.organization,
    employee: null,
    isApiKey: true,
  };
  req.authType = "api_key";
  req.apiKey = key;
  req.apiKeyScopes = scopes;
  scopeRequestToTenant("API_KEY", key.organizationId);

  prisma.orgApiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return null;
};

const authenticate = async (req, res, next) => {
  // Routers that share a mount path (payroll + statutory on /api/payroll) each
  // run authenticate; the first pass already loaded and checked the user.
  if (req.authType && req.user) return next();
  try {
    const apiKey = extractApiKey(req);
    if (apiKey) {
      const rejected = await authenticateWithApiKey(req, res, apiKey);
      if (rejected) return rejected;
      return tenantRateLimiter(req, res, next);
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization token required",
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        organization: organizationWithSubscription,
        employee: {
          include: {
            branch: true,
            shift: true,
            department: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found or token no longer valid",
      });
    }

    // Terminated/suspended users keep a technically valid JWT until it expires,
    // so access has to be re-checked against the database on every request.
    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated.",
      });
    }

    if (user.organization?.deletedAt) {
      return res.status(403).json({
        success: false,
        message: "This organization is no longer active.",
      });
    }

    if (user.employee?.deletedAt) {
      return res.status(403).json({
        success: false,
        message: "This employee profile has been removed.",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      twoFactorEnabled: Boolean(user.twoFactorEnabledAt),
      organization: user.organization,
      employee: user.employee,
    };
    req.authType = "jwt";
    scopeRequestToTenant(user.role, user.organizationId);

    const blocked = denyIfLocked(req, res, user.organization);
    if (blocked) return blocked;

    const needsTwoFactor = denyIfTenantTwoFactorMissing(req, res);
    if (needsTwoFactor) return needsTwoFactor;

    return tenantRateLimiter(req, res, next);
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

/**
 * Role-Based Access Control (RBAC) middleware.
 * Integration API keys skip role checks and are gated by scopes instead.
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required before checking role permissions",
      });
    }

    // Scope was already enforced in authenticate.
    if (req.authType === "api_key") return next();

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: User role '${req.user.role}' is not authorized to access this resource.`,
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
    }

    next();
  };
};

// Company admins manage attendance for employees through the admin-mark flow;
// they are not attendance candidates for self-service punch actions.
const denyCompanyAdminSelfPunch = (req, res, next) => {
  if (req.user?.role === "COMPANY_ADMIN") {
    return res.status(403).json({
      success: false,
      code: "SELF_ATTENDANCE_NOT_APPLICABLE",
      message: "Company admins do not punch in or out for themselves.",
    });
  }
  return next();
};

const requireFeature = (flag, label) => (req, res, next) => {
  try {
    assertFeature(req.user?.organization, flag, label);
    return next();
  } catch (err) {
    return res.status(err.statusCode || 403).json({
      success: false,
      code: err.code || "FEATURE_LOCKED",
      message: err.message,
    });
  }
};

module.exports = {
  authenticate,
  authorizeRoles,
  denyCompanyAdminSelfPunch,
  requiredScopeFor,
  parseScopes,
  requireFeature,
};
