const rateStore = new Map();
const { getRedis, logRedisError } = require("../config/redis");
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
  const applyResult = (req, res, next, count, resetAt) => {
    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("RateLimit-Limit", max);
      res.setHeader("RateLimit-Remaining", 0);
      res.setHeader("RateLimit-Reset", retryAfter);
      return res.status(429).json({
        success: false,
        message: message || `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfterSeconds: retryAfter,
      });
    }
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - count));
    res.setHeader("RateLimit-Reset", Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
    return next();
  };

  const enforceLocal = (req, res, next, key) => {
    const now = Date.now();
    const entry = rateStore.get(key);
    if (!entry || now > entry.resetAt) {
      const resetAt = now + windowMs;
      rateStore.set(key, { count: 1, resetAt });
      return applyResult(req, res, next, 1, resetAt);
    }
    entry.count += 1;
    return applyResult(req, res, next, entry.count, entry.resetAt);
  };

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
    if (!process.env.REDIS_URL) return enforceLocal(req, res, next, key);

    return getRedis()
      .then(async (redis) => {
        if (!redis) return enforceLocal(req, res, next, key);
        const result = await redis.eval(
          "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {count,redis.call('PTTL',KEYS[1])}",
          { keys: [`workpulse:rate:${key}`], arguments: [String(windowMs)] },
        );
        const count = Number(result[0]);
        const ttl = Math.max(1, Number(result[1]));
        return applyResult(req, res, next, count, Date.now() + ttl);
      })
      .catch((error) => {
        logRedisError(error);
        return enforceLocal(req, res, next, key);
      });
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

// Session restoration happens on page loads and should not consume the much
// tighter credential-attempt budget used for login and password recovery.
const sessionRateLimiter = createRateLimiter({
  namespace: "session",
  windowMs: 60 * 1000,
  max: 60,
  keyBy: "ip",
  message: "Too many session refresh attempts. Please wait a moment.",
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
  sessionRateLimiter,
  apiRateLimiter,
  strictRateLimiter,
};
