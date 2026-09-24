import "dotenv/config";
import { defineConfig } from "prisma/config";

const dbUrl = (process.env.DATABASE_URL || "").trim();

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env before running Prisma commands."
  );
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
