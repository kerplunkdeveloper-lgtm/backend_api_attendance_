const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { errorHandler, statusOf } = require("../src/middleware/errorHandler.middleware");

const originalEnv = process.env.NODE_ENV;
const originalWarn = console.warn;
const originalError = console.error;
let warnings;
let errors;

const fakeRes = ({ headersSent = false } = {}) => {
  const res = { headersSent, statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

const run = (err, { req = {}, res = fakeRes() } = {}) => {
  const forwarded = [];
  errorHandler(err, { method: "GET", requestId: "req-1", ...req }, res, (e) => forwarded.push(e));
  return { res, forwarded };
};

describe("error handler", () => {
  beforeEach(() => {
    warnings = [];
    errors = [];
    console.warn = (...args) => warnings.push(args);
    console.error = (...args) => errors.push(args);
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
    process.env.NODE_ENV = originalEnv;
  });

  it("logs a routine client error as one line, without a stack trace", () => {
    const err = Object.assign(new Error("Invalid or expired onboarding invitation link"), { statusCode: 404 });

    const { res } = run(err);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, "Invalid or expired onboarding invitation link");
    assert.equal(errors.length, 0, "a 404 is not an incident");
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].length, 1, "no error object (and so no stack) is attached");
    const record = JSON.parse(warnings[0][0]);
    assert.equal(record.event, "http.client_error");
    assert.equal(record.requestId, "req-1");
    assert.equal(record.error.message, "Invalid or expired onboarding invitation link");
  });

  it("logs a server fault in full so it can be debugged", () => {
    const err = new Error("boom");

    const { res } = run(err);

    assert.equal(res.statusCode, 500);
    assert.equal(errors.length, 1);
    const record = JSON.parse(errors[0][0]);
    assert.equal(record.event, "http.request_failed");
    assert.equal(record.error.message, "boom");
    assert.equal(record.requestId, "req-1");
  });

  it("never logs the request URL, which can carry invite or reset tokens", () => {
    const err = Object.assign(new Error("nope"), { statusCode: 404 });

    run(err, { req: { originalUrl: "/api/onboarding/portal/SECRET-TOKEN", url: "/portal/SECRET-TOKEN", path: "/portal/SECRET-TOKEN", route: { path: "/portal/:token" } } });

    assert.ok(!warnings[0].join(" ").includes("SECRET-TOKEN"));
    assert.match(warnings[0][0], /\/portal\/:token/);
  });

  it("keeps database and driver codes out of server-error responses", () => {
    process.env.NODE_ENV = "production";
    const err = Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { code: "P2002" });

    const { res } = run(err);

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, "Internal Server Error");
    assert.equal("code" in res.body, false);
    assert.equal(res.body.requestId, "req-1");
  });

  it("still returns the code on client errors, where callers rely on it", () => {
    const err = Object.assign(new Error("Your plan does not include this"), { statusCode: 403, code: "PLAN_FEATURE_LOCKED" });

    const { res } = run(err);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "PLAN_FEATURE_LOCKED");
  });

  it("turns a nonsense status into a 500 instead of throwing inside the handler", () => {
    for (const statusCode of ["abc", 200, 99, 700, NaN, null]) {
      const { res } = run(Object.assign(new Error("x"), { statusCode }));
      assert.equal(res.statusCode, 500, `statusCode ${String(statusCode)}`);
    }
    assert.equal(statusOf({ status: 413 }), 413);
  });

  it("answers a disallowed origin with 403", () => {
    const { res } = run(new Error("Not allowed by CORS"));

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, "Origin not allowed");
  });

  it("hands over to Express when the response has already started", () => {
    const err = new Error("failed mid-stream");

    const { res, forwarded } = run(err, { res: fakeRes({ headersSent: true }) });

    assert.deepEqual(forwarded, [err]);
    assert.equal(res.statusCode, null, "no second response is attempted");
  });

  it("only exposes the stack in development", () => {
    process.env.NODE_ENV = "development";
    assert.ok(run(new Error("x")).res.body.stack);

    process.env.NODE_ENV = "production";
    assert.equal("stack" in run(new Error("x")).res.body, false);
  });
});
