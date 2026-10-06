import "dotenv/config";
import { defineConfig } from "prisma/config";

// Production uses one canonical database URL for both runtime traffic and
// migrations. This avoids deployments accidentally selecting a stale or
// malformed secondary URL.
const normalizeDatabaseUrl = (value: string) => {
  let url = value.trim().replace(/^psql\s+/i, "").trim();
  if (
    (url.startsWith("'") && url.endsWith("'")) ||
    (url.startsWith('"') && url.endsWith('"'))
  ) {
    url = url.slice(1, -1).trim();
  }
  return url;
};

const dbUrl = normalizeDatabaseUrl(
  process.env.DATABASE_URL || "",
);

const directUrl = process.env.DIRECT_URL
  ? normalizeDatabaseUrl(process.env.DIRECT_URL)
  : dbUrl;

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL is required before running Prisma commands."
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // Migrations should use the direct (non-pooled) Neon endpoint when set.
    url: directUrl,
  },
});
