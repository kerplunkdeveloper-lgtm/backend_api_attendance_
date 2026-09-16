import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const NEON_PRODUCTION_URL =
  "postgresql://neondb_owner:npg_dSVOQNUIf24F@ep-flat-mountain-ay9pcqr8-pooler.c-5.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

let dbUrl = (process.env.DATABASE_URL || "").trim();
if (!dbUrl || dbUrl.includes("base") || !dbUrl.includes("neon.tech")) {
  dbUrl = NEON_PRODUCTION_URL;
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    url: dbUrl,
  },
});