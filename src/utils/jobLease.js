const crypto = require("crypto");
const os = require("os");
const prisma = require("../config/database");

// Unique per process, so a restarted instance never inherits its old lease.
const HOLDER = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

/**
 * Atomically takes or renews the named lease. Returns true when this process
 * holds it for the next `ttlMs`. A crashed holder's lease simply expires, and
 * the next instance to ask takes over.
 */
async function acquireLease(name, ttlMs, client = prisma) {
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await client.$queryRaw`
    INSERT INTO "JobLease" ("name", "holder", "expiresAt")
    VALUES (${name}, ${HOLDER}, ${expiresAt})
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "JobLease"."expiresAt" < NOW() OR "JobLease"."holder" = EXCLUDED."holder"
    RETURNING "holder"`;
  return rows.length === 1 && rows[0].holder === HOLDER;
}

/**
 * Runs `fn` only on the instance holding the lease. Errors taking the lease
 * (database blip) skip this tick rather than letting every instance run it.
 */
async function runIfLeader(name, ttlMs, fn, client = prisma) {
  let leader = false;
  try {
    leader = await acquireLease(name, ttlMs, client);
  } catch (err) {
    console.error(`[jobLease] could not take lease "${name}":`, err.message);
    return { ran: false };
  }
  if (!leader) return { ran: false };
  return { ran: true, result: await fn() };
}

module.exports = { HOLDER, acquireLease, runIfLeader };
