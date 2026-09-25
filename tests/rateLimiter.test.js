const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../src/middleware/rateLimiter.middleware");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("rate limiter", () => {
  it("keeps independent limiters isolated for the same client", () => {
    const first = createRateLimiter({ namespace: "test-first", max: 1 });
    const second = createRateLimiter({ namespace: "test-second", max: 1 });
    const req = { ip: "203.0.113.10", socket: {} };
    let firstPassed = false;
    let secondPassed = false;

    first(req, responseRecorder(), () => {
      firstPassed = true;
    });
    second(req, responseRecorder(), () => {
      secondPassed = true;
    });

    assert.equal(firstPassed, true);
    assert.equal(secondPassed, true);
  });

  it("blocks requests after a limiter's own maximum", () => {
    const limiter = createRateLimiter({ namespace: "test-limit", max: 1 });
    const req = { ip: "203.0.113.11", socket: {} };
    limiter(req, responseRecorder(), () => {});

    const blocked = responseRecorder();
    limiter(req, blocked, () => assert.fail("second request should be blocked"));

    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body.success, false);
    assert.ok(Number(blocked.headers["Retry-After"]) > 0);
  });
});
