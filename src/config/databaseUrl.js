function parsePostgresUrl(name, value) {
  let connectionString = String(value || "").trim();
  // Railway variables are sometimes pasted as `psql 'postgresql://...'` or
  // with literal surrounding quotes. Accept those harmless wrappers.
  connectionString = connectionString.replace(/^psql\s+/i, "").trim();
  if (
    (connectionString.startsWith("'") && connectionString.endsWith("'")) ||
    (connectionString.startsWith('"') && connectionString.endsWith('"'))
  ) {
    connectionString = connectionString.slice(1, -1).trim();
  }
  if (!connectionString) return null;

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection string.`);
  }

  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`${name} must be a postgresql:// connection string.`);
  }

  return { connectionString, url };
}

function neonEndpointIdentity(hostname) {
  const match = hostname.match(/^(ep-[^.]+?)(?:-pooler)?(\..+\.neon\.tech)$/i);
  if (!match) return null;
  return `${match[1].toLowerCase()}${match[2].toLowerCase()}`;
}

/**
 * Runtime traffic must use the same Neon database that receives migrations.
 * When the two configured Neon endpoint identities differ, the direct URL is
 * the authoritative migrated database for this deployment.
 */
function resolveRuntimeDatabaseUrl(env = process.env, warn = console.warn) {
  const explicitRuntime = parsePostgresUrl(
    "RUNTIME_DATABASE_URL",
    env.RUNTIME_DATABASE_URL,
  );
  if (explicitRuntime) return explicitRuntime.connectionString;

  const pooled = parsePostgresUrl("DATABASE_URL", env.DATABASE_URL);

  if (!pooled) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide a PostgreSQL connection string.",
    );
  }

  return pooled.connectionString;
}

module.exports = { neonEndpointIdentity, resolveRuntimeDatabaseUrl };
