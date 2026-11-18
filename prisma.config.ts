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

// Test migrations must be able to pin Prisma to an isolated database without
// rewriting the developer's .env or risking a Production/Alpha URL.
const dbUrl = normalizeDatabaseUrl(
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "",
);

// Neon branch checkouts provide DATABASE_URL_UNPOOLED. Prefer it so schema
// commands cannot accidentally keep using a stale DIRECT_URL from another
// branch or environment.
const directUrl = process.env.TEST_DATABASE_URL
  ? dbUrl
  : process.env.DATABASE_URL_UNPOOLED
  ? normalizeDatabaseUrl(process.env.DATABASE_URL_UNPOOLED)
  : process.env.DIRECT_URL
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
