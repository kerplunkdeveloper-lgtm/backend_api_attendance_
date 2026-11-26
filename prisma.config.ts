import "dotenv/config";
import { defineConfig } from "prisma/config";

// Runtime traffic may use Neon's pooled endpoint, but Prisma Migrate needs a
// direct/unpooled connection so session state and migration persistence are
// reliable. Keep TEST_DATABASE_URL first for isolated migration tests.
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
const configuredUrl = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL_UNPOOLED
  || process.env.DIRECT_URL
  || process.env.DATABASE_URL
  || "";
const dbUrl = normalizeDatabaseUrl(configuredUrl);

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL is required before running Prisma commands."
  );
}

try {
  const host = new URL(dbUrl).hostname.toLowerCase();
  if (host.includes("-pooler.")) {
    throw new Error(
      "Prisma migrations require a direct Neon connection. Set DATABASE_URL_UNPOOLED (preferred) or DIRECT_URL; keep the pooled DATABASE_URL for runtime traffic.",
    );
  }
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Prisma migrations require")) throw error;
  throw new Error("DATABASE_URL for Prisma migrations must be a valid PostgreSQL URL.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    // This is deliberately the direct/unpooled URL for Prisma Migrate.
    url: dbUrl,
  },
});
