const crypto = require("crypto");
const { createClient } = require("redis");

let client = null;
let subscriber = null;
let connectPromise = null;
let subscriberConnectPromise = null;
let lastErrorLogAt = 0;

const logRedisError = (error) => {
  const now = Date.now();
  if (now - lastErrorLogAt < 60000) return;
  lastErrorLogAt = now;
  console.error("[redis] unavailable; using safe local fallback:", error.message);
};

const getRedis = async () => {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  if (!client) {
    client = createClient({ url });
    client.on("error", logRedisError);
  }
  if (!client.isOpen) {
    connectPromise ||= client.connect().finally(() => {
      connectPromise = null;
    });
    await connectPromise;
  }
  return client;
};

/**
 * Redis clients cannot issue normal commands after SUBSCRIBE, so realtime
 * consumers use a duplicated connection. The duplicate is created lazily so
 * applications that only need rate limiting do not open an extra connection.
 */
const getRedisSubscriber = async () => {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  const redis = await getRedis();
  if (!redis) return null;
  if (!subscriber) {
    subscriber = redis.duplicate();
    subscriber.on("error", logRedisError);
  }
  if (!subscriber.isOpen) {
    subscriberConnectPromise ||= subscriber.connect().finally(() => {
      subscriberConnectPromise = null;
    });
    await subscriberConnectPromise;
  }
  return subscriber;
};

const publishRedis = async (channel, payload) => {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    await redis.publish(channel, JSON.stringify(payload));
    return true;
  } catch (error) {
    logRedisError(error);
    return false;
  }
};

const withRedisLock = async (key, ttlMs, task) => {
  let redis;
  try {
    redis = await getRedis();
  } catch (error) {
    logRedisError(error);
  }
  if (!redis) return task();

  const token = crypto.randomUUID();
  const acquired = await redis.set(key, token, { NX: true, PX: ttlMs });
  if (!acquired) return null;
  try {
    return await task();
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { keys: [key], arguments: [token] },
    ).catch(logRedisError);
  }
};

const disconnectRedis = async () => {
  if (client?.isOpen) await client.close();
  if (subscriber?.isOpen) await subscriber.close();
};

module.exports = {
  disconnectRedis,
  getRedis,
  getRedisSubscriber,
  logRedisError,
  publishRedis,
  withRedisLock,
};
