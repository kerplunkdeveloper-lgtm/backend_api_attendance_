const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

process.env.LOGIN_HASH_WORKERS = "2";
process.env.LOGIN_HASH_MAX_QUEUE = "3";
const { verifyPassword, verifierStats, shutdownVerifier } = require("../src/utils/passwordVerifier");

describe("bounded password verification", () => {
  after(() => shutdownVerifier());

  it("matches bcrypt.compare for right and wrong passwords", async () => {
    const hash = await bcrypt.hash("Correct-horse1", 4);
    assert.equal(await verifyPassword("Correct-horse1", hash), true);
    assert.equal(await verifyPassword("wrong-password1", hash), false);
  });

  it("treats a missing hash as a failed match", async () => {
    assert.equal(await verifyPassword("anything1", undefined), false);
  });

  it("keeps the event loop responsive while comparisons run", async () => {
    const hash = await bcrypt.hash("Correct-horse1", 10);
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    await verifyPassword("Correct-horse1", hash);
    clearInterval(timer);
    // A cost-10 compare takes >100ms; on the main thread nothing else would tick.
    assert.ok(ticks >= 5, `event loop only ticked ${ticks} times`);
  });

  it("sheds load with a retryable 503 once the queue is full", async () => {
    const hash = await bcrypt.hash("Correct-horse1", 10);
    // 2 workers busy + 3 queued = 5 accepted; the rest must be rejected, not buffered.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => verifyPassword("Correct-horse1", hash)),
    );
    const rejected = results.filter((r) => r.status === "rejected");
    assert.ok(rejected.length >= 1, "expected some requests to be shed");
    for (const r of rejected) {
      assert.equal(r.reason.statusCode, 503);
      assert.equal(r.reason.code, "AUTH_BUSY");
      assert.ok(r.reason.retryAfterSeconds >= 1);
    }
    assert.ok(results.some((r) => r.status === "fulfilled" && r.value === true));
    assert.ok(verifierStats().shed >= rejected.length);
  });
});
