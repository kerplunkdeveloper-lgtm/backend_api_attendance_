const rateStore = new Map();
let limiterSequence = 0;
/**
 * Creates an Express rate-limiter middleware.
 * @param {object} options
 * @param {number} options.windowMs     - Window duration in milliseconds
 * @param {number} options.max          - Max requests per window per key
 * @param {string} options.keyBy        - "ip" (default) | "user" (uses req.user.id if authenticated)
 * @param {string} options.message      - Custom error message
 */
const createRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  max = 100,
  keyBy = "ip",
  message,
  namespace = `limiter-${++limiterSequence}`,
}) => {
  return (req, res, next) => {
    let subject;
    if (keyBy === "user" && req.user?.id) {
      subject = `user:${req.user.id}`;
    } else {
      // req.ip only trusts forwarding headers when Express is explicitly
      // configured with trusted proxies. Directly reading X-Forwarded-For lets
      // clients evade the limiter by inventing a new address per request.
      subject = `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
    }
    const key = `${namespace}:${subject}`;

    const now = Date.now();
    const entry = rateStore.get(key);

    if (!entry || now > entry.resetAt) {
      // Start fresh window
      rateStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", 0);
      return res.status(429).json({
        success: false,
        message:
          message ||
          `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfterSeconds: retryAfter,
      });
    }

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - entry.count));
    return next();
  };
};

// ── Preset limiters ────────────────────────────────────────────────────────────

/**
 * Auth limiter: 10 attempts per 15 minutes per IP
 * Protects login/register from brute force
 */
const authRateLimiter = createRateLimiter({
  namespace: "auth",
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyBy: "ip",
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});

/**
 * General API limiter: 200 requests per minute per IP
 * Protects all other endpoints from abuse
 */
const apiRateLimiter = createRateLimiter({
  namespace: "api",
  windowMs: 60 * 1000,
  max: 200,
  keyBy: "ip",
  message: "Too many requests. Please slow down.",
});

/**
 * Strict limiter for sensitive operations: 5 per hour per IP
 * Use on password reset, admin bulk operations, etc.
 */
const strictRateLimiter = createRateLimiter({
  namespace: "strict",
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyBy: "ip",
  message: "Too many requests for this operation. Please try again in an hour.",
});

// Periodically clean up stale entries every 10 minutes to prevent memory leak
const cleanupTimer = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateStore.entries()) {
      if (now > entry.resetAt) rateStore.delete(key);
    }
  },
  10 * 60 * 1000,
);
cleanupTimer.unref?.();

module.exports = {
  createRateLimiter,
  authRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
};
