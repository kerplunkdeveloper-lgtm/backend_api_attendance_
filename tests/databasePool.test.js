const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installModule } = require("./helpers/mockPrisma");

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/test";
delete process.env.RUNTIME_DATABASE_URL;

const pools = [];
class FakePool extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    pools.push(this);
  }
}

class FakePrismaClient {
  $extends() {
    return this;
  }
}

installModule(require.resolve("pg"), { Pool: FakePool });
installModule(require.resolve("@prisma/adapter-pg"), { PrismaPg: class {} });
installModule(require.resolve("@prisma/client"), { PrismaClient: FakePrismaClient });

describe("database pool", () => {
  it("survives the database closing an idle connection", () => {
    require("../src/config/database");
    const [pool] = pools;
    assert.ok(pool, "the module should create a pg pool");

    // pg emits 'error' on the pool when an idle client dies. An 'error' event with
    // no listener is an uncaught exception, and server.js exits the API on those.
    assert.ok(pool.listenerCount("error") >= 1, "the pool needs an error listener");

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      assert.doesNotThrow(() => pool.emit("error", new Error("terminating connection due to administrator command")));
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /idle connection closed by the database/);
  });
});
