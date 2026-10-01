const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveRuntimeDatabaseUrl } = require("../src/config/databaseUrl");

describe("database URL selection", () => {
  it("uses the canonical database URL", () => {
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

  it("does not select a secondary database URL", () => {
    const pooled = "postgresql://user:pass@ep-old-pooler.c-1.us-east-1.aws.neon.tech/db";
    const direct = "postgresql://user:pass@ep-current.c-2.us-east-2.aws.neon.tech/db";

    assert.equal(
      resolveRuntimeDatabaseUrl(
        { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct },
        () => assert.fail("secondary URL must not be inspected"),
      ),
      pooled,
    );
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

  it("requires the canonical database URL", () => {
    assert.throws(
      () => resolveRuntimeDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgresql://user:pass@localhost:5432/workpulse" }),
      /DATABASE_URL is not set/,
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
