require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { resolveRuntimeDatabaseUrl } = require("./databaseUrl");

const connectionString = resolveRuntimeDatabaseUrl();

// Some networks complete TCP to Neon over IPv4 but stall the TLS/Postgres
// handshake, so every query hits connectionTimeoutMillis. DB_DNS_RESULT_ORDER
// (ipv4first | ipv6first | verbatim) lets such hosts prefer the working family.
// Node abandons the first address family after 250ms by default, which is
// shorter than a transatlantic connect, so give the preferred family longer.
const dnsResultOrder = String(process.env.DB_DNS_RESULT_ORDER || "").trim();
if (dnsResultOrder) {
  require("dns").setDefaultResultOrder(dnsResultOrder);
  require("net").setDefaultAutoSelectFamilyAttemptTimeout(
    Number(process.env.DB_FAMILY_ATTEMPT_TIMEOUT_MS) || 2500,
  );
}

const { Pool } = require("pg");
const pool = new Pool({
  connectionString,
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
  query_timeout: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

const adapter = new PrismaPg(pool);
// Remote Neon round-trips make the 5s default too tight for multi-step
// transactions (payroll runs, imports); allow more headroom before aborting.
const prisma = new PrismaClient({
  adapter,
  // Secrets are never loaded by default, so no API response or nested include
  // can leak them. Queries that truly need one opt in with `omit: WITH_SECRETS`.
  omit: {
    user: { passwordHash: true, twoFactorSecret: true, twoFactorBackupCodes: true, twoFactorLastStep: true },
  },
  transactionOptions: { maxWait: 10000, timeout: 20000 },
});

module.exports = prisma;
