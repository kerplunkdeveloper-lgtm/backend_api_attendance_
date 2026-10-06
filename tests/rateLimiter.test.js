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

describe("login rate limiter", () => {
  const { loginRateLimiter } = require("../src/middleware/rateLimiter.middleware");

  function finishableResponse(statusCode) {
    const res = responseRecorder();
    const listeners = [];
    res.statusCode = statusCode;
    res.on = (event, fn) => event === "finish" && listeners.push(fn);
    res.finish = () => listeners.forEach((fn) => fn());
    return res;
  }

  it("does not count successful sign-ins from a shared office IP", () => {
    for (let i = 0; i < 25; i += 1) {
      const req = { ip: "198.51.100.1", socket: {}, body: { email: "a@corp.test" } };
      const res = finishableResponse(200);
      let passed = false;
      loginRateLimiter(req, res, () => {
        passed = true;
      });
      assert.equal(passed, true, `success login #${i + 1} should pass`);
      res.finish();
    }
  });

  it("locks only the targeted email after repeated failures", () => {
    const attempt = (email, status) => {
      const req = { ip: "198.51.100.2", socket: {}, body: { email } };
      const res = finishableResponse(status);
      let passed = false;
      loginRateLimiter(req, res, () => {
        passed = true;
      });
      if (passed) res.finish();
      return { passed, res };
    };

    for (let i = 0; i < 10; i += 1) assert.equal(attempt("victim@corp.test", 401).passed, true);
    const blocked = attempt("victim@corp.test", 401);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    assert.equal(attempt("colleague@corp.test", 200).passed, true);
  });
});
