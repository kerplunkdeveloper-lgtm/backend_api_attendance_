const crypto = require("crypto");

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const containsForbiddenKey = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child, seen)) return true;
  }
  return false;
};

const requestContext = (req, res, next) => {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  req.requestId = /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

const rejectUnsafePayload = (req, res, next) => {
  if (containsForbiddenKey(req.body) || containsForbiddenKey(req.query)) {
    return res.status(400).json({
      success: false,
      message: "Request contains a forbidden object key.",
      requestId: req.requestId,
    });
  }
  return next();
};

const trustedWebOrigins = () => {
  const values = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || "").split(","),
  ];
  return new Set(
    values
      .map((value) => String(value || "").trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
};

const protectCookieMutation = (req, res, next) => {
  const platform = String(
    req.body?.client || req.headers["x-client-platform"] || "",
  ).toLowerCase();
  const isBrowserRequest = Boolean(req.headers.origin) ||
    Boolean(req.cookies?.refreshToken) ||
    platform === "web" ||
    platform === "browser";
  if (!isBrowserRequest) return next();

  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (
    origin &&
    (trustedWebOrigins().has(origin) ||
      (process.env.NODE_ENV !== "production" && local))
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Untrusted browser origin.",
    requestId: req.requestId,
  });
};

module.exports = {
  protectCookieMutation,
  rejectUnsafePayload,
  requestContext,
};
