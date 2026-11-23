require("dotenv").config();

const { validateEnvironment } = require("../src/config/environment");
const { Client } = require("pg");

const REQUIRED_MIGRATION = "20261012190000_oidc_sso";
let client;

// Verify the same canonical database URL used by the running API. Production
// has previously supplied a stale/unrelated unpooled URL; checking that URL
// after a successful migration made healthy releases fail preflight.
const migrationDatabaseUrl = process.env.DATABASE_URL;

async function main() {
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Production preflight requires NODE_ENV=production.");
  }
  validateEnvironment();
  const timeoutMs = Number(process.env.PREFLIGHT_DB_TIMEOUT_MS) || 10000;
  client = new Client({
    connectionString: migrationDatabaseUrl,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
  });
  await client.connect();
  const result = await client.query(
    'SELECT "migration_name" FROM public."_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL LIMIT 1',
    [REQUIRED_MIGRATION],
  );
  if (result.rows.length !== 1) {
    throw new Error(`Database migration ${REQUIRED_MIGRATION} is not applied. Run prisma migrate deploy before serving traffic.`);
  }
  console.log(`Production preflight passed. Required migration applied: ${REQUIRED_MIGRATION}`);
}

main()
  .catch((error) => {
    console.error(`[preflight] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (client) await client.end().catch(() => {});
  });
