require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const connectionString = (process.env.DATABASE_URL || "").trim();

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and provide a PostgreSQL connection string.",
  );
}

if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
  throw new Error(
    "DATABASE_URL must be a postgresql:// connection string. Refusing to start with an unrecognised value.",
  );
}

const { Pool } = require("pg");
const pool = new Pool({
  connectionString,
  max: 15,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
