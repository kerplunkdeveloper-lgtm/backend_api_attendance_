import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma migrations require a direct Postgres session. Keep DATABASE_URL for
// pooled application traffic and prefer the direct Neon endpoint here.
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
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
);

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED or DATABASE_URL is required before running Prisma commands."
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
