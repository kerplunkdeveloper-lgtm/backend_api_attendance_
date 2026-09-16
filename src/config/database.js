require("dotenv").config();
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const NEON_PRODUCTION_URL =
  "postgresql://neondb_owner:npg_dSVOQNUIf24F@ep-flat-mountain-ay9pcqr8-pooler.c-5.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

let connectionString = (process.env.DATABASE_URL || "").trim();

// Protect against missing DATABASE_URL or Railway's unresolved internal host '@base'
if (!connectionString || connectionString.includes("@base") || connectionString === "base") {
  console.warn("⚠️ DATABASE_URL was missing or pointed to unreachable host 'base'. Falling back to production Neon database.");
  connectionString = NEON_PRODUCTION_URL;
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
