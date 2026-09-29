require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");
const { resolveRuntimeDatabaseUrl } = require("./databaseUrl");

const connectionString = resolveRuntimeDatabaseUrl();

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
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
