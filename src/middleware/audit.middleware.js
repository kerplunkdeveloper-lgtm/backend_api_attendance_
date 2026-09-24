const auditService = require("../services/audit.service");

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Request body keys that must never reach the audit table. */
const REDACTED_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "confirmPassword",
  "tempPassword",
  "passwordHash",
  "token",
  "refreshToken",
  "accessToken",
  "unlockCode",
  "enteredCode",
  "apiKey",
  "secret",
  "receiptData",
  "image",
  "file",
  "customHtml",
  "signature",
]);

/** Maps a URL path segment to the audit `entity` label. */
const ENTITY_BY_SEGMENT = {
  auth: "AUTH",
  employees: "EMPLOYEE",
  departments: "DEPARTMENT",
  branches: "BRANCH",
  shifts: "SHIFT",
  "shift-overrides": "SHIFT_OVERRIDE",
  attendance: "ATTENDANCE",
  leaves: "LEAVE",
  holidays: "HOLIDAY",
  payroll: "PAYROLL",
  expenses: "EXPENSE",
  compoff: "COMP_OFF",
  overtime: "OVERTIME",
  onboarding: "ONBOARDING",
  offboarding: "OFFBOARDING",
  assets: "ASSET",
  devices: "DEVICE",
  policy: "POLICY",
  notifications: "NOTIFICATION",
  upload: "UPLOAD",
};

const resolveEntity = (path) => {
  const segments = path.split("/").filter(Boolean);
  const head = segments[0] === "api" ? segments[1] : segments[0];
  return ENTITY_BY_SEGMENT[head] || (head ? head.toUpperCase() : "UNKNOWN");
};

const resolveAction = (method, path) => {
  const lower = path.toLowerCase();
  if (lower.includes("/review") || lower.includes("/approve")) return "APPROVE";
  if (lower.includes("/reject")) return "REJECT";
  if (lower.includes("/cancel")) return "CANCEL";
  if (method === "DELETE") return "DELETE";
  if (method === "POST") return "CREATE";
  return "UPDATE";
};

const sanitize = (value, depth = 0) => {
  if (depth > 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => sanitize(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key)) {
      out[key] = "[redacted]";
    } else if (typeof val === "string" && val.length > 300) {
      out[key] = `${val.slice(0, 300)}…`;
    } else {
      out[key] = sanitize(val, depth + 1);
    }
  }
  return out;
};

const clientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length)
    return forwarded.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
};

/**
 * Attach after the auth middleware. Logging happens on response `finish` so the
 * request is never delayed and a logging failure cannot break the response.
 */
const auditLogger = (req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();

  res.on("finish", () => {
    // Only successful mutations are interesting; failures are noise.
    if (res.statusCode >= 400) return;
    if (!req.user?.organizationId) return;

    const details = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ...(req.params && Object.keys(req.params).length
        ? { params: req.params }
        : {}),
      ...(req.body && Object.keys(req.body).length
        ? { body: sanitize(req.body) }
        : {}),
    };

    auditService
      .logAction({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        action: resolveAction(req.method, req.path),
        entity: resolveEntity(req.originalUrl || req.path),
        entityId: req.params?.id || null,
        details,
        ipAddress: clientIp(req),
      })
      .catch(() => {});
  });

  next();
};

module.exports = { auditLogger };
