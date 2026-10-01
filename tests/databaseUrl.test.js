const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveRuntimeDatabaseUrl } = require("../src/config/databaseUrl");

describe("database URL selection", () => {
  it("keeps the pooled URL when it matches the direct Neon endpoint", () => {
    const pooled = "postgresql://user:pass@ep-same-pooler.c-1.us-east-1.aws.neon.tech/db";
    const direct = "postgresql://user:pass@ep-same.c-1.us-east-1.aws.neon.tech/db";

    assert.equal(
      resolveRuntimeDatabaseUrl(
        { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct },
        () => assert.fail("matching URLs must not warn"),
      ),
      pooled,
    );
  });

  it("uses the migrated direct URL when Neon endpoints differ", () => {
    const warnings = [];
    const pooled = "postgresql://user:pass@ep-old-pooler.c-1.us-east-1.aws.neon.tech/db";
    const direct = "postgresql://user:pass@ep-current.c-2.us-east-2.aws.neon.tech/db";

    assert.equal(
      resolveRuntimeDatabaseUrl(
        { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct },
        (message) => warnings.push(message),
      ),
      direct,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /different Neon endpoints/);
  });

  it("allows an explicit runtime URL override", () => {
    const runtime = "postgresql://user:pass@ep-runtime.c-1.us-east-1.aws.neon.tech/db";
    assert.equal(
      resolveRuntimeDatabaseUrl(
        {
          RUNTIME_DATABASE_URL: runtime,
          DATABASE_URL: "postgresql://invalid",
        },
        () => assert.fail("an explicit runtime URL must not warn"),
      ),
      runtime,
    );
  });

  it("accepts the direct URL when no pooled URL is configured", () => {
    const direct = "postgresql://user:pass@localhost:5432/workpulse";
    assert.equal(
      resolveRuntimeDatabaseUrl({ DATABASE_URL_UNPOOLED: direct }),
      direct,
    );
  });

  it("normalizes common Railway database URL wrappers", () => {
    const direct = "postgresql://user:pass@localhost:5432/workpulse";
    assert.equal(resolveRuntimeDatabaseUrl({ DATABASE_URL: `psql '${direct}'` }), direct);
    assert.equal(resolveRuntimeDatabaseUrl({ DATABASE_URL: `\"${direct}\"` }), direct);
  });

  it("rejects malformed and non-PostgreSQL URLs", () => {
    assert.throws(
      () => resolveRuntimeDatabaseUrl({ DATABASE_URL: "not a URL" }),
      /valid PostgreSQL connection string/,
    );
    assert.throws(
      () => resolveRuntimeDatabaseUrl({ DATABASE_URL: "https://example.com/db" }),
      /postgresql:\/\//,
    );
  });
});
