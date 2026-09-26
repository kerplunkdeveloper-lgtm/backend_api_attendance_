const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const { verifyAccessToken } = require("../utils/jwt");
const { organizationWithSubscription } = require("../utils/prismaSelects");
const { evaluateEntitlement, isRecoveryPath, resolveLimits, assertFeature } = require("../services/entitlement.service");
const { DEFAULT_API_KEY_SCOPES } = require("../config/plans");

const parseScopes = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [...DEFAULT_API_KEY_SCOPES];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const requiredScopeFor = (req) => {
  const path = String(req.originalUrl || req.path || "").toLowerCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (path.includes("/employees")) return write ? "write:employees" : "read:employees";
  if (path.includes("/attendance")) return write ? "write:attendance" : "read:attendance";
  if (path.includes("/reports")) return write ? "write:reports" : "read:reports";
  if (path.includes("/payroll")) return write ? "write:payroll" : "read:payroll";
  if (path.includes("/leaves")) return write ? "write:leave" : "read:leave";
  if (path.includes("/biometric")) return write ? "write:biometric" : "read:biometric";
  return write ? "write:admin" : "read:admin";
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

const denyIfLocked = (req, res, org) => {
  if (isRecoveryPath(req)) return null;
  const entitlement = evaluateEntitlement(org);
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
  req.apiKeyScopes = parseScopes(key.scopes);

  prisma.orgApiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return null;
};

const authenticate = async (req, res, next) => {
  try {
    const apiKey = extractApiKey(req);
    if (apiKey) {
      const rejected = await authenticateWithApiKey(req, res, apiKey);
      if (rejected) return rejected;
      return next();
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
      organization: user.organization,
      employee: user.employee,
    };
    req.authType = "jwt";

    const blocked = denyIfLocked(req, res, user.organization);
    if (blocked) return blocked;

    next();
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

    if (req.authType === "api_key") {
      const needed = requiredScopeFor(req);
      if (!req.apiKeyScopes?.includes(needed)) {
        return res.status(403).json({
          success: false,
          message: `API key is missing scope '${needed}'`,
          requiredScope: needed,
        });
      }
      return next();
    }

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
  requiredScopeFor,
  parseScopes,
  requireFeature,
};
