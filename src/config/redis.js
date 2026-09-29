const crypto = require("crypto");
const { createClient } = require("redis");

let client = null;
let connectPromise = null;
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
};

module.exports = { disconnectRedis, getRedis, logRedisError, withRedisLock };
