function parsePostgresUrl(name, value) {
  const connectionString = String(value || "").trim();
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
  const direct = parsePostgresUrl("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED);

  if (!pooled && !direct) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide a PostgreSQL connection string.",
    );
  }

  if (!pooled) return direct.connectionString;
  if (!direct) return pooled.connectionString;

  const pooledIdentity = neonEndpointIdentity(pooled.url.hostname);
  const directIdentity = neonEndpointIdentity(direct.url.hostname);
  if (pooledIdentity && directIdentity && pooledIdentity !== directIdentity) {
    warn(
      "[database] DATABASE_URL and DATABASE_URL_UNPOOLED reference different Neon endpoints; " +
        "using DATABASE_URL_UNPOOLED for runtime traffic. Update both variables " +
        "to the same Neon project and branch when possible.",
    );
    return direct.connectionString;
  }

  return pooled.connectionString;
}

module.exports = { neonEndpointIdentity, resolveRuntimeDatabaseUrl };
