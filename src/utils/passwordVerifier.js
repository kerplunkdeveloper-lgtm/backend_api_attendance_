/**
 * Bounded password verification.
 *
 * bcrypt at cost 10 burns ~100-250 ms of CPU per comparison. Done on the main
 * thread (bcryptjs is pure JS) a login spike stalls every other request on the
 * instance, including health checks, until the load balancer starts killing it.
 *
 * This runs comparisons on a small pool of worker threads and sheds load
 * deliberately: when the queue is full, or a job waited too long, callers get a
 * 503 + Retry-After (clients retry with jitter) instead of the whole process
 * becoming unresponsive. Capacity is roughly `workers x (1000 / bcrypt ms)`
 * logins per second per instance; add instances to raise it.
 *
 * Env:
 *   LOGIN_HASH_WORKERS          worker threads (default cpus-1, max 8; 0 = main thread)
 *   LOGIN_HASH_MAX_QUEUE        waiting comparisons before shedding (default 500)
 *   LOGIN_HASH_QUEUE_TIMEOUT_MS max time a comparison may wait (default 8000)
 */
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const bcrypt = require("bcryptjs");

const intEnv = (name, fallback, { min = 0 } = {}) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
};

const WORKER_FILE = path.join(__dirname, "passwordVerifier.worker.js");
const poolSize = () => intEnv("LOGIN_HASH_WORKERS", Math.min(8, Math.max(1, os.cpus().length - 1)));
const maxQueue = () => intEnv("LOGIN_HASH_MAX_QUEUE", 500, { min: 1 });
const queueTimeoutMs = () => intEnv("LOGIN_HASH_QUEUE_TIMEOUT_MS", 8000, { min: 1 });

const slots = []; // { worker, job }
const queue = []; // { password, hash, enqueuedAt, resolve, reject }
let nextId = 0;
const stats = { shed: 0, completed: 0 };

const busyError = (retryAfterSeconds) => {
  const error = new Error("Sign-in is very busy right now. Please try again in a few seconds.");
  error.statusCode = 503;
  error.code = "AUTH_BUSY";
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
};

const estimateRetryAfter = () => Math.min(30, Math.max(2, Math.ceil(queue.length / Math.max(1, slots.length || 1) / 4)));

function spawn() {
  const slot = { worker: new Worker(WORKER_FILE), job: null };
  // Never keep the process alive just for the pool.
  slot.worker.unref();
  slot.worker.on("message", (message) => {
    const job = slot.job;
    if (!job || job.id !== message.id) return;
    slot.job = null;
    stats.completed += 1;
    if (message.error) job.reject(new Error(message.error));
    else job.resolve(Boolean(message.ok));
    pump();
  });
  const onDeath = (error) => {
    const index = slots.indexOf(slot);
    if (index >= 0) slots.splice(index, 1);
    if (slot.job) slot.job.reject(error || new Error("password worker exited"));
    slot.job = null;
    // Replace a crashed worker so capacity does not decay.
    if (slots.length < poolSize()) {
      try { slots.push(spawn()); } catch { /* fall back to main-thread compare */ }
    }
    pump();
  };
  slot.worker.once("error", onDeath);
  slot.worker.once("exit", () => onDeath());
  return slot;
}

function ensurePool() {
  const size = poolSize();
  while (slots.length < size) slots.push(spawn());
}

function pump() {
  const now = Date.now();
  const timeout = queueTimeoutMs();
  while (queue.length) {
    const slot = slots.find((s) => !s.job);
    if (!slot) return;
    const next = queue.shift();
    if (now - next.enqueuedAt > timeout) {
      stats.shed += 1;
      next.reject(busyError(estimateRetryAfter()));
      continue;
    }
    slot.job = { id: ++nextId, resolve: next.resolve, reject: next.reject };
    slot.worker.postMessage({ id: slot.job.id, password: next.password, hash: next.hash });
  }
}

/** Resolves true/false like bcrypt.compare; rejects with a 503 error when overloaded. */
function verifyPassword(password, hash) {
  if (!hash) return Promise.resolve(false);
  if (poolSize() === 0) return bcrypt.compare(password, hash);

  try {
    ensurePool();
  } catch {
    return bcrypt.compare(password, hash);
  }
  if (queue.length >= maxQueue()) {
    stats.shed += 1;
    return Promise.reject(busyError(estimateRetryAfter()));
  }
  return new Promise((resolve, reject) => {
    queue.push({ password, hash, enqueuedAt: Date.now(), resolve, reject });
    pump();
  });
}

/** Start the workers at boot so the first login spike does not pay thread start-up. */
function warmVerifier() {
  if (poolSize() === 0) return;
  try { ensurePool(); } catch (error) { console.warn("[auth] password worker pool not started:", error.message); }
}

/** Test/ops helper. */
const verifierStats = () => ({ ...stats, queued: queue.length, workers: slots.length });

/** Terminate the pool (tests, graceful shutdown). */
async function shutdownVerifier() {
  const closing = slots.splice(0).map((slot) => {
    slot.worker.removeAllListeners("exit");
    return slot.worker.terminate();
  });
  queue.splice(0).forEach((job) => job.reject(busyError(2)));
  await Promise.allSettled(closing);
}

module.exports = { verifyPassword, warmVerifier, verifierStats, shutdownVerifier };
